// Generated from contracts/out/BrokerRegistry.sol by scripts/gen-abis.ts. Do not edit.
export const brokerRegistryAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "dir_",
        "type": "address",
        "internalType": "contract Directory"
      }
    ],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "addExposure",
    "inputs": [
      {
        "name": "b",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "assetId",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "units",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "assetsOf",
    "inputs": [
      {
        "name": "b",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint32[]",
        "internalType": "uint32[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "bondBps",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "brokerCount",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "brokerOf",
    "inputs": [
      {
        "name": "b",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct Broker",
        "components": [
          {
            "name": "tier",
            "type": "uint8",
            "internalType": "enum Tier"
          },
          {
            "name": "status",
            "type": "uint8",
            "internalType": "enum BrokerStatus"
          },
          {
            "name": "boIdHash",
            "type": "bytes32",
            "internalType": "bytes32"
          },
          {
            "name": "delegate",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "joinedAt",
            "type": "uint64",
            "internalType": "uint64"
          },
          {
            "name": "healthLowSince",
            "type": "uint64",
            "internalType": "uint64"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "brokerOfBoId",
    "inputs": [
      {
        "name": "",
        "type": "bytes32",
        "internalType": "bytes32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "brokers",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address[]",
        "internalType": "address[]"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "capacityValue",
    "inputs": [
      {
        "name": "b",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "delegateOf",
    "inputs": [
      {
        "name": "b",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "dir",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract Directory"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "exit",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "exposureUnits",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "",
        "type": "uint32",
        "internalType": "uint32"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "exposureValue",
    "inputs": [
      {
        "name": "b",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "value",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "health",
    "inputs": [
      {
        "name": "b",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "join",
    "inputs": [
      {
        "name": "tier",
        "type": "uint8",
        "internalType": "enum Tier"
      },
      {
        "name": "boIdHash",
        "type": "bytes32",
        "internalType": "bytes32"
      },
      {
        "name": "delegate",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "name",
        "type": "string",
        "internalType": "string"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "markDefaulted",
    "inputs": [
      {
        "name": "b",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "markDraining",
    "inputs": [
      {
        "name": "b",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "minBond",
    "inputs": [
      {
        "name": "t",
        "type": "uint8",
        "internalType": "enum Tier"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "nameOf",
    "inputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "string",
        "internalType": "string"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "onBondChanged",
    "inputs": [
      {
        "name": "b",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "poke",
    "inputs": [
      {
        "name": "b",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "refreshWiring",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "requiredBond",
    "inputs": [
      {
        "name": "b",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "setDelegate",
    "inputs": [
      {
        "name": "delegate",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "setDraining",
    "inputs": [],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "statusOf",
    "inputs": [
      {
        "name": "b",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "enum BrokerStatus"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "subExposure",
    "inputs": [
      {
        "name": "b",
        "type": "address",
        "internalType": "address"
      },
      {
        "name": "assetId",
        "type": "uint32",
        "internalType": "uint32"
      },
      {
        "name": "units",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "tierCap",
    "inputs": [
      {
        "name": "t",
        "type": "uint8",
        "internalType": "enum Tier"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "tierFor",
    "inputs": [
      {
        "name": "value",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "outputs": [
      {
        "name": "",
        "type": "uint8",
        "internalType": "enum Tier"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "totalExposureUnits",
    "inputs": [
      {
        "name": "b",
        "type": "address",
        "internalType": "address"
      }
    ],
    "outputs": [
      {
        "name": "total",
        "type": "uint256",
        "internalType": "uint256"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "wiring",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "tuple",
        "internalType": "struct Wired.W",
        "components": [
          {
            "name": "usdc",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "treasury",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "params",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "sessionClock",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "priceOracle",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "compliance",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "roles",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "assets",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "bondVault",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "brokers",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "levelBook",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "pledges",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "redemption",
            "type": "address",
            "internalType": "address"
          },
          {
            "name": "exchange",
            "type": "address",
            "internalType": "address"
          }
        ]
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "event",
    "name": "BrokerJoined",
    "inputs": [
      {
        "name": "broker",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "tier",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum Tier"
      },
      {
        "name": "boIdHash",
        "type": "bytes32",
        "indexed": false,
        "internalType": "bytes32"
      },
      {
        "name": "delegate",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      },
      {
        "name": "name",
        "type": "string",
        "indexed": false,
        "internalType": "string"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "BrokerStatusChanged",
    "inputs": [
      {
        "name": "broker",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "from",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum BrokerStatus"
      },
      {
        "name": "to",
        "type": "uint8",
        "indexed": false,
        "internalType": "enum BrokerStatus"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "DelegateSet",
    "inputs": [
      {
        "name": "broker",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "delegate",
        "type": "address",
        "indexed": false,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "ExposureChanged",
    "inputs": [
      {
        "name": "broker",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "assetId",
        "type": "uint32",
        "indexed": true,
        "internalType": "uint32"
      },
      {
        "name": "units",
        "type": "uint256",
        "indexed": false,
        "internalType": "uint256"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "HealthLow",
    "inputs": [
      {
        "name": "broker",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      },
      {
        "name": "since",
        "type": "uint64",
        "indexed": false,
        "internalType": "uint64"
      }
    ],
    "anonymous": false
  },
  {
    "type": "event",
    "name": "WiringRefreshed",
    "inputs": [],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "BoIdTaken",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BrokerExists",
    "inputs": []
  },
  {
    "type": "error",
    "name": "BrokerNotFound",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ExposureOpen",
    "inputs": []
  },
  {
    "type": "error",
    "name": "NotWired",
    "inputs": []
  },
  {
    "type": "error",
    "name": "PledgeTooLarge",
    "inputs": []
  },
  {
    "type": "error",
    "name": "WrongRole",
    "inputs": []
  },
  {
    "type": "error",
    "name": "WrongStatus",
    "inputs": []
  },
  {
    "type": "error",
    "name": "ZeroAddress",
    "inputs": []
  }
] as const;
