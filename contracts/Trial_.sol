pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract ClinicalTrialRegistry is ZamaEthereumConfig {
    struct PatientRecord {
        string patientId;
        euint32 encryptedCondition;
        uint256 age;
        uint256 weight;
        string medicalHistory;
        address patientAddress;
        uint256 registrationTime;
        uint32 decryptedCondition;
        bool isEligible;
    }

    mapping(string => PatientRecord) public patientRecords;
    string[] public patientIds;

    event PatientRegistered(string indexed patientId, address indexed patientAddress);
    event EligibilityVerified(string indexed patientId, uint32 decryptedCondition);

    constructor() ZamaEthereumConfig() {}

    function registerPatient(
        string calldata patientId,
        string calldata name,
        externalEuint32 encryptedCondition,
        bytes calldata inputProof,
        uint256 age,
        uint256 weight,
        string calldata medicalHistory
    ) external {
        require(bytes(patientRecords[patientId].patientId).length == 0, "Patient already registered");
        require(FHE.isInitialized(FHE.fromExternal(encryptedCondition, inputProof)), "Invalid encrypted input");

        patientRecords[patientId] = PatientRecord({
            patientId: name,
            encryptedCondition: FHE.fromExternal(encryptedCondition, inputProof),
            age: age,
            weight: weight,
            medicalHistory: medicalHistory,
            patientAddress: msg.sender,
            registrationTime: block.timestamp,
            decryptedCondition: 0,
            isEligible: false
        });

        FHE.allowThis(patientRecords[patientId].encryptedCondition);
        FHE.makePubliclyDecryptable(patientRecords[patientId].encryptedCondition);

        patientIds.push(patientId);
        emit PatientRegistered(patientId, msg.sender);
    }

    function verifyEligibility(
        string calldata patientId,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(patientRecords[patientId].patientId).length > 0, "Patient not found");
        require(!patientRecords[patientId].isEligible, "Eligibility already verified");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(patientRecords[patientId].encryptedCondition);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);

        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));

        patientRecords[patientId].decryptedCondition = decodedValue;
        patientRecords[patientId].isEligible = true;

        emit EligibilityVerified(patientId, decodedValue);
    }

    function getEncryptedCondition(string calldata patientId) external view returns (euint32) {
        require(bytes(patientRecords[patientId].patientId).length > 0, "Patient not found");
        return patientRecords[patientId].encryptedCondition;
    }

    function getPatientRecord(string calldata patientId) external view returns (
        string memory name,
        uint256 age,
        uint256 weight,
        string memory medicalHistory,
        address patientAddress,
        uint256 registrationTime,
        bool isEligible,
        uint32 decryptedCondition
    ) {
        require(bytes(patientRecords[patientId].patientId).length > 0, "Patient not found");
        PatientRecord storage record = patientRecords[patientId];

        return (
            record.patientId,
            record.age,
            record.weight,
            record.medicalHistory,
            record.patientAddress,
            record.registrationTime,
            record.isEligible,
            record.decryptedCondition
        );
    }

    function getAllPatientIds() external view returns (string[] memory) {
        return patientIds;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}


