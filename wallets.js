// wallets.js
// Liste des clés privées utilisées par le MetaRelayer
// ⚠️ UNIQUEMENT POUR LE TESTNET / DEV, JAMAIS EN PROD ⚠️

export const PRIVATE_KEYS = [
    "0xcb12e0a76b7236a7af54740d7b3ca0ee87b89b750d8f9c4e91e8f91c8a01de69",
    "0x50c1c5070740567bd0fb7b3be19d13e27f58d97b347f35986e9e44531b047607",
    "0x41e6ece75b37792d31ec958118b395afe65e760b6e814ac453f40c6a44a53111",
    "0xcae2ed7776bc26dad1f96f755f7502da3a6bc85698d3806da9ddb690ec1ccf2d",
    "0xc51b33b686041d55282e824e0647e0f613bcdfd620a8295184b46b644feb72ac",
    "0xdc50b1a23894df828d9d6c4fec4aeaebcf1d8ed52bc391f8ac7d668c79b4cbbe",
    "0x0bd2bdb5376508f26418ec89b5a80d5e759c3410d39d249e763070e83c6a952f",
    "0x70979e68f05f9bfc004c7f14e30161e162fe6dc6f2916aee76c2b3dae9b7b5b9",
    "0x86f2787cc70180bafc77931b5b6ceff83edb6c93f00769e04ee5ebcbcbf164f3",
    "0x71d9e04170b25647e32490e5b476a69a28c1e87eef5e99c78820dcf03b055de3",
    "0x422436e8366253e66217b6e8f008909789d368b13ba76af66fe6e22e7ee2972e"
    // Tu peux en rajouter jusqu'à 50 ici si tu veux
  ];
  
  export function getPrivateKeyAt(index) {
    const n = PRIVATE_KEYS.length;
    if (n === 0) {
      throw new Error("No private keys configured in wallets.js");
    }
    const i = ((index % n) + n) % n; // modulo safe
    return PRIVATE_KEYS[i];
  }
  
  export function getWalletCount() {
    return PRIVATE_KEYS.length;
  }
  