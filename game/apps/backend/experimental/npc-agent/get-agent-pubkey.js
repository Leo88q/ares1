const { Keypair } = require('@solana/web3.js');
const fs = require('fs');

const secretKey = JSON.parse(fs.readFileSync('agent-wallet.json', 'utf-8'));
const keypair = Keypair.fromSecretKey(new Uint8Array(secretKey));
console.log(keypair.publicKey.toString());
