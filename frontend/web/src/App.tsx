import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface TrialData {
  id: string;
  name: string;
  age: number;
  conditionScore: number;
  treatmentPhase: number;
  description: string;
  creator: string;
  timestamp: number;
  isVerified?: boolean;
  decryptedValue?: number;
}

interface TrialStats {
  totalTrials: number;
  verifiedPatients: number;
  avgCondition: number;
  activeTrials: number;
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
  const [newTrialData, setNewTrialData] = useState({ name: "", age: "", condition: "", phase: "", description: "" });
  const [selectedTrial, setSelectedTrial] = useState<TrialData | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeTab, setActiveTab] = useState("trials");

  const { status, initialize, isInitialized } = useFhevm();
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
            conditionScore: Number(businessData.publicValue2) || 0,
            treatmentPhase: 0,
            description: businessData.description,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading trial data:', e);
        }
      }
      
      setTrials(trialsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
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
        parseInt(newTrialData.condition) || 0,
        parseInt(newTrialData.phase) || 0,
        newTrialData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Trial created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewTrialData({ name: "", age: "", condition: "", phase: "", description: "" });
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
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
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
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const testAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available and working!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Contract test failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredTrials = trials.filter(trial => 
    trial.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    trial.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const trialStats: TrialStats = {
    totalTrials: trials.length,
    verifiedPatients: trials.filter(t => t.isVerified).length,
    avgCondition: trials.length > 0 ? trials.reduce((sum, t) => sum + t.conditionScore, 0) / trials.length : 0,
    activeTrials: trials.filter(t => t.treatmentPhase > 0).length
  };

  const renderStats = () => (
    <div className="stats-grid">
      <div className="stat-card neon-purple">
        <h3>Total Trials</h3>
        <div className="stat-value">{trialStats.totalTrials}</div>
      </div>
      <div className="stat-card neon-blue">
        <h3>Verified Patients</h3>
        <div className="stat-value">{trialStats.verifiedPatients}</div>
      </div>
      <div className="stat-card neon-pink">
        <h3>Avg Condition</h3>
        <div className="stat-value">{trialStats.avgCondition.toFixed(1)}</div>
      </div>
      <div className="stat-card neon-green">
        <h3>Active Trials</h3>
        <div className="stat-value">{trialStats.activeTrials}</div>
      </div>
    </div>
  );

  const renderFAQ = () => (
    <div className="faq-section">
      <h3>FHE Clinical Trials FAQ</h3>
      <div className="faq-item">
        <h4>What is FHE encryption?</h4>
        <p>Fully Homomorphic Encryption allows computation on encrypted data without decryption, protecting patient privacy.</p>
      </div>
      <div className="faq-item">
        <h4>How is my data protected?</h4>
        <p>Patient ages are encrypted using Zama FHE and only decrypted with proper authorization and verification.</p>
      </div>
      <div className="faq-item">
        <h4>Who can access my data?</h4>
        <p>Only authorized pharmaceutical researchers can perform homomorphic screening on encrypted data.</p>
      </div>
    </div>
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header metal-header">
          <div className="logo">
            <h1>Confidential Clinical Trials 🔬</h1>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔬</div>
            <h2>Connect Your Wallet to Access Clinical Trials</h2>
            <p>Secure, encrypted patient enrollment system powered by Zama FHE technology</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading clinical trials system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header metal-header">
        <div className="logo">
          <h1>Confidential Clinical Trials 🔬</h1>
        </div>
        
        <div className="header-actions">
          <button onClick={testAvailability} className="test-btn">
            Test Contract
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Trial
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <nav className="app-nav">
        <button 
          className={`nav-btn ${activeTab === "trials" ? "active" : ""}`}
          onClick={() => setActiveTab("trials")}
        >
          Clinical Trials
        </button>
        <button 
          className={`nav-btn ${activeTab === "stats" ? "active" : ""}`}
          onClick={() => setActiveTab("stats")}
        >
          Statistics
        </button>
        <button 
          className={`nav-btn ${activeTab === "faq" ? "active" : ""}`}
          onClick={() => setActiveTab("faq")}
        >
          FAQ
        </button>
      </nav>
      
      <main className="main-content">
        {activeTab === "trials" && (
          <div className="trials-section">
            <div className="section-header">
              <h2>Active Clinical Trials</h2>
              <div className="header-controls">
                <input 
                  type="text" 
                  placeholder="Search trials..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="search-input"
                />
                <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
              </div>
            </div>
            
            <div className="trials-list">
              {filteredTrials.length === 0 ? (
                <div className="no-trials">
                  <p>No clinical trials found</p>
                  <button onClick={() => setShowCreateModal(true)} className="create-btn">
                    Create First Trial
                  </button>
                </div>
              ) : filteredTrials.map((trial, index) => (
                <div 
                  className={`trial-item ${selectedTrial?.id === trial.id ? "selected" : ""}`} 
                  key={index}
                  onClick={() => setSelectedTrial(trial)}
                >
                  <div className="trial-header">
                    <h3>{trial.name}</h3>
                    <span className={`status-badge ${trial.isVerified ? "verified" : "pending"}`}>
                      {trial.isVerified ? "✅ Verified" : "🔒 Encrypted"}
                    </span>
                  </div>
                  <div className="trial-meta">
                    <span>Condition Score: {trial.conditionScore}/10</span>
                    <span>Age: {trial.isVerified ? trial.decryptedValue : "🔒 FHE Encrypted"}</span>
                  </div>
                  <p className="trial-desc">{trial.description}</p>
                  <div className="trial-footer">
                    <span>Created: {new Date(trial.timestamp * 1000).toLocaleDateString()}</span>
                    <span>By: {trial.creator.substring(0, 6)}...{trial.creator.substring(38)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        {activeTab === "stats" && (
          <div className="stats-section">
            <h2>Clinical Trials Statistics</h2>
            {renderStats()}
            <div className="charts-section">
              <h3>Patient Distribution</h3>
              <div className="chart-placeholder">
                <p>FHE-protected analytics visualization</p>
              </div>
            </div>
          </div>
        )}
        
        {activeTab === "faq" && (
          <div className="faq-tab">
            <h2>Frequently Asked Questions</h2>
            {renderFAQ()}
          </div>
        )}
      </main>
      
      {showCreateModal && (
        <ModalCreateTrial 
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
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptData(selectedTrial.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateTrial: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  trialData: any;
  setTrialData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, trialData, setTrialData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'age' || name === 'condition' || name === 'phase') {
      const intValue = value.replace(/[^\d]/g, '');
      setTrialData({ ...trialData, [name]: intValue });
    } else {
      setTrialData({ ...trialData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-trial-modal">
        <div className="modal-header">
          <h2>New Clinical Trial Enrollment</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Patient Privacy Protection</strong>
            <p>Patient age will be encrypted with Zama FHE technology</p>
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
              placeholder="Enter age..." 
              min="0"
            />
            <div className="data-type-label">🔐 FHE Encrypted Integer</div>
          </div>
          
          <div className="form-group">
            <label>Medical Condition Score (1-10) *</label>
            <input 
              type="number" 
              min="1" 
              max="10" 
              name="condition" 
              value={trialData.condition} 
              onChange={handleChange} 
              placeholder="Condition severity..." 
            />
            <div className="data-type-label">Public Data</div>
          </div>
          
          <div className="form-group">
            <label>Treatment Phase *</label>
            <input 
              type="number" 
              min="0" 
              max="10" 
              name="phase" 
              value={trialData.phase} 
              onChange={handleChange} 
              placeholder="Treatment phase..." 
            />
          </div>
          
          <div className="form-group">
            <label>Medical Description *</label>
            <textarea 
              name="description" 
              value={trialData.description} 
              onChange={handleChange} 
              placeholder="Enter medical condition description..." 
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !trialData.name || !trialData.age || !trialData.condition} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting and Creating..." : "Create Trial Enrollment"}
          </button>
        </div>
      </div>
    </div>
  );
};

const TrialDetailModal: React.FC<{
  trial: TrialData;
  onClose: () => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ trial, onClose, isDecrypting, decryptData }) => {
  const handleDecrypt = async () => {
    if (trial.isVerified) return;
    await decryptData();
  };

  return (
    <div className="modal-overlay">
      <div className="trial-detail-modal">
        <div className="modal-header">
          <h2>Trial Patient Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="trial-info">
            <div className="info-row">
              <span>Patient Name:</span>
              <strong>{trial.name}</strong>
            </div>
            <div className="info-row">
              <span>Creator:</span>
              <strong>{trial.creator.substring(0, 6)}...{trial.creator.substring(38)}</strong>
            </div>
            <div className="info-row">
              <span>Date Created:</span>
              <strong>{new Date(trial.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
            <div className="info-row">
              <span>Condition Score:</span>
              <strong>{trial.conditionScore}/10</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Encrypted Patient Data</h3>
            
            <div className="data-row">
              <div className="data-label">Patient Age:</div>
              <div className="data-value">
                {trial.isVerified ? 
                  `${trial.decryptedValue} (On-chain Verified)` : 
                  "🔒 FHE Encrypted Integer"
                }
              </div>
              <button 
                className={`decrypt-btn ${trial.isVerified ? 'verified' : ''}`}
                onClick={handleDecrypt} 
                disabled={isDecrypting || trial.isVerified}
              >
                {isDecrypting ? "🔓 Verifying..." : trial.isVerified ? "✅ Verified" : "🔓 Verify Age"}
              </button>
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔬</div>
              <div>
                <strong>FHE Clinical Trial Protection</strong>
                <p>Patient age is encrypted on-chain using Zama FHE technology for privacy-preserving medical research.</p>
              </div>
            </div>
          </div>
          
          <div className="description-section">
            <h3>Medical Description</h3>
            <p>{trial.description}</p>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;


