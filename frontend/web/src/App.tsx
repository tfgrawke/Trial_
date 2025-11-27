import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface TrialData {
  id: string;
  name: string;
  age: number;
  condition: string;
  treatment: string;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [trials, setTrials] = useState<TrialData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingTrial, setCreatingTrial] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newTrialData, setNewTrialData] = useState({ 
    name: "", 
    age: "", 
    condition: "", 
    treatment: "" 
  });
  const [selectedTrial, setSelectedTrial] = useState<TrialData | null>(null);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [stats, setStats] = useState({ total: 0, verified: 0, avgAge: 0 });

  const { initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const trialsList: TrialData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          trialsList.push({
            id: businessId,
            name: businessData.name,
            age: Number(businessData.publicValue1) || 0,
            condition: businessData.description,
            treatment: "Experimental Treatment",
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setTrials(trialsList);
      updateStats(trialsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const updateStats = (trialsList: TrialData[]) => {
    const total = trialsList.length;
    const verified = trialsList.filter(t => t.isVerified).length;
    const avgAge = total > 0 ? trialsList.reduce((sum, t) => sum + t.age, 0) / total : 0;
    
    setStats({ total, verified, avgAge });
  };

  const createTrial = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingTrial(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating trial with FHE encryption..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const ageValue = parseInt(newTrialData.age) || 0;
      const businessId = `trial-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, ageValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newTrialData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        ageValue,
        0,
        newTrialData.condition
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Trial created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewTrialData({ name: "", age: "", condition: "", treatment: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingTrial(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ 
          visible: true, 
          status: "success", 
          message: "Data is already verified on-chain" 
        });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Decryption failed: " + (e.message || "Unknown error") 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const available = await contract.isAvailable();
      setTransactionStatus({ 
        visible: true, 
        status: "success", 
        message: "Contract is available and ready" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ 
        visible: true, 
        status: "error", 
        message: "Availability check failed" 
      });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredTrials = trials.filter(trial => 
    trial.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    trial.condition.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const renderStatsPanel = () => (
    <div className="stats-panels">
      <div className="stat-panel">
        <div className="stat-icon">👥</div>
        <div className="stat-content">
          <div className="stat-value">{stats.total}</div>
          <div className="stat-label">Total Participants</div>
        </div>
      </div>
      
      <div className="stat-panel">
        <div className="stat-icon">✅</div>
        <div className="stat-content">
          <div className="stat-value">{stats.verified}</div>
          <div className="stat-label">Verified Data</div>
        </div>
      </div>
      
      <div className="stat-panel">
        <div className="stat-icon">📊</div>
        <div className="stat-content">
          <div className="stat-value">{stats.avgAge.toFixed(1)}</div>
          <div className="stat-label">Average Age</div>
        </div>
      </div>
    </div>
  );

  const renderFHEProcess = () => (
    <div className="fhe-process">
      <div className="process-step">
        <div className="step-number">1</div>
        <div className="step-content">
          <h4>Patient Enrollment</h4>
          <p>Sensitive data encrypted with FHE before submission</p>
        </div>
      </div>
      <div className="process-step">
        <div className="step-number">2</div>
        <div className="step-content">
          <h4>Homomorphic Screening</h4>
          <p>Pharma companies screen encrypted data without decryption</p>
        </div>
      </div>
      <div className="process-step">
        <div className="step-number">3</div>
        <div className="step-content">
          <h4>Secure Verification</h4>
          <p>Selective decryption with on-chain proof verification</p>
        </div>
      </div>
    </div>
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo-section">
            <h1>Confidential Clinical Trials 🔐</h1>
            <p>Secure Patient Enrollment with FHE Protection</p>
          </div>
          <ConnectButton />
        </header>
        
        <div className="welcome-section">
          <div className="welcome-content">
            <div className="welcome-icon">💊</div>
            <h2>Privacy-First Clinical Trials</h2>
            <p>Connect your wallet to participate in confidential clinical trials with fully homomorphic encryption protection.</p>
            <div className="feature-grid">
              <div className="feature-item">
                <span className="feature-icon">🔒</span>
                <h4>Encrypted Data</h4>
                <p>Patient data remains encrypted throughout the process</p>
              </div>
              <div className="feature-item">
                <span className="feature-icon">⚡</span>
                <h4>Homomorphic Screening</h4>
                <p>Pharma companies screen encrypted data directly</p>
              </div>
              <div className="feature-item">
                <span className="feature-icon">🛡️</span>
                <h4>Selective Access</h4>
                <p>Controlled decryption with patient consent</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="loading-spinner"></div>
        <p>Initializing FHE Security System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="loading-spinner"></div>
      <p>Loading Clinical Trials Database...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-section">
          <h1>Confidential Clinical Trials 🔐</h1>
          <p>FHE-Protected Patient Data Management</p>
        </div>
        
        <div className="header-actions">
          <button className="availability-btn" onClick={checkAvailability}>
            Check System
          </button>
          <ConnectButton />
        </div>
      </header>

      <main className="main-content">
        <section className="dashboard-section">
          <div className="section-header">
            <h2>Clinical Trials Dashboard</h2>
            <button 
              className="create-trial-btn"
              onClick={() => setShowCreateModal(true)}
            >
              + New Trial Enrollment
            </button>
          </div>
          
          {renderStatsPanel()}
          
          <div className="fhe-info-panel">
            <h3>FHE Protection Process</h3>
            {renderFHEProcess()}
          </div>
        </section>

        <section className="trials-section">
          <div className="section-toolbar">
            <div className="search-box">
              <input
                type="text"
                placeholder="Search trials or conditions..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <button 
              className="refresh-btn"
              onClick={loadData}
              disabled={isRefreshing}
            >
              {isRefreshing ? "Refreshing..." : "Refresh Data"}
            </button>
          </div>

          <div className="trials-grid">
            {filteredTrials.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">💊</div>
                <p>No clinical trials found</p>
                <button 
                  className="create-btn"
                  onClick={() => setShowCreateModal(true)}
                >
                  Enroll First Patient
                </button>
              </div>
            ) : (
              filteredTrials.map((trial) => (
                <div 
                  key={trial.id}
                  className={`trial-card ${trial.isVerified ? 'verified' : ''}`}
                  onClick={() => setSelectedTrial(trial)}
                >
                  <div className="card-header">
                    <h3>{trial.name}</h3>
                    <span className={`status-badge ${trial.isVerified ? 'verified' : 'pending'}`}>
                      {trial.isVerified ? '✅ Verified' : '🔒 Encrypted'}
                    </span>
                  </div>
                  
                  <div className="card-content">
                    <div className="info-row">
                      <span>Age:</span>
                      <strong>{trial.age} years</strong>
                    </div>
                    <div className="info-row">
                      <span>Condition:</span>
                      <span>{trial.condition}</span>
                    </div>
                    <div className="info-row">
                      <span>Enrolled:</span>
                      <span>{new Date(trial.timestamp * 1000).toLocaleDateString()}</span>
                    </div>
                  </div>
                  
                  {trial.isVerified && trial.decryptedValue && (
                    <div className="decrypted-info">
                      <span>Decrypted Age: {trial.decryptedValue}</span>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
      </main>

      {showCreateModal && (
        <CreateTrialModal
          onSubmit={createTrial}
          onClose={() => setShowCreateModal(false)}
          creating={creatingTrial}
          trialData={newTrialData}
          setTrialData={setNewTrialData}
          isEncrypting={isEncrypting}
        />
      )}

      {selectedTrial && (
        <TrialDetailModal
          trial={selectedTrial}
          onClose={() => setSelectedTrial(null)}
          onDecrypt={() => decryptData(selectedTrial.id)}
          isDecrypting={fheIsDecrypting}
        />
      )}

      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          <div className="toast-content">
            <span className="toast-message">{transactionStatus.message}</span>
          </div>
        </div>
      )}

      <footer className="app-footer">
        <div className="footer-content">
          <p>Confidential Clinical Trials - Powered by FHE Technology</p>
          <div className="footer-links">
            <span>Privacy First</span>
            <span>•</span>
            <span>Secure Enrollment</span>
            <span>•</span>
            <span>Encrypted Screening</span>
          </div>
        </div>
      </footer>
    </div>
  );
};

const CreateTrialModal: React.FC<{
  onSubmit: () => void;
  onClose: () => void;
  creating: boolean;
  trialData: any;
  setTrialData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, trialData, setTrialData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setTrialData({ ...trialData, [name]: value });
  };

  return (
    <div className="modal-overlay">
      <div className="modal-container">
        <div className="modal-header">
          <h2>New Patient Enrollment</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        
        <div className="modal-body">
          <div className="encryption-notice">
            <span className="encryption-icon">🔐</span>
            <p>Patient age will be encrypted using FHE technology for privacy protection</p>
          </div>
          
          <div className="form-group">
            <label>Patient Name *</label>
            <input
              type="text"
              name="name"
              value={trialData.name}
              onChange={handleChange}
              placeholder="Enter patient name..."
            />
          </div>
          
          <div className="form-group">
            <label>Age (FHE Encrypted) *</label>
            <input
              type="number"
              name="age"
              value={trialData.age}
              onChange={handleChange}
              placeholder="Enter patient age..."
              min="1"
              max="120"
            />
            <div className="field-note">Encrypted integer only</div>
          </div>
          
          <div className="form-group">
            <label>Medical Condition *</label>
            <textarea
              name="condition"
              value={trialData.condition}
              onChange={handleChange}
              placeholder="Describe the medical condition..."
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button className="cancel-btn" onClick={onClose}>Cancel</button>
          <button
            className="submit-btn"
            onClick={onSubmit}
            disabled={creating || isEncrypting || !trialData.name || !trialData.age || !trialData.condition}
          >
            {creating || isEncrypting ? "Encrypting and Submitting..." : "Enroll Patient"}
          </button>
        </div>
      </div>
    </div>
  );
};

const TrialDetailModal: React.FC<{
  trial: TrialData;
  onClose: () => void;
  onDecrypt: () => void;
  isDecrypting: boolean;
}> = ({ trial, onClose, onDecrypt, isDecrypting }) => {
  return (
    <div className="modal-overlay">
      <div className="modal-container">
        <div className="modal-header">
          <h2>Patient Trial Details</h2>
          <button className="close-btn" onClick={onClose}>×</button>
        </div>
        
        <div className="modal-body">
          <div className="detail-section">
            <h3>Patient Information</h3>
            <div className="detail-grid">
              <div className="detail-item">
                <span>Name:</span>
                <strong>{trial.name}</strong>
              </div>
              <div className="detail-item">
                <span>Age:</span>
                <strong>
                  {trial.isVerified ? 
                    `${trial.decryptedValue} (Decrypted)` : 
                    "🔒 FHE Encrypted"
                  }
                </strong>
              </div>
              <div className="detail-item">
                <span>Condition:</span>
                <span>{trial.condition}</span>
              </div>
              <div className="detail-item">
                <span>Enrollment Date:</span>
                <span>{new Date(trial.timestamp * 1000).toLocaleDateString()}</span>
              </div>
            </div>
          </div>
          
          <div className="encryption-section">
            <h3>Data Security Status</h3>
            <div className={`security-status ${trial.isVerified ? 'verified' : 'encrypted'}`}>
              <div className="status-icon">
                {trial.isVerified ? '✅' : '🔐'}
              </div>
              <div className="status-info">
                <h4>{trial.isVerified ? 'Data Verified' : 'FHE Encrypted'}</h4>
                <p>
                  {trial.isVerified ? 
                    'Patient age has been decrypted and verified on-chain' : 
                    'Patient age is encrypted using FHE technology'
                  }
                </p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button className="close-btn" onClick={onClose}>Close</button>
          {!trial.isVerified && (
            <button
              className="decrypt-btn"
              onClick={onDecrypt}
              disabled={isDecrypting}
            >
              {isDecrypting ? "Decrypting..." : "Verify Decryption"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;