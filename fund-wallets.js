// fund-wallets.js
// Script pour:
//  - Parcourir toutes les clés de wallets.js
//  - Checker leur solde en natif
//  - Si < 0.5 ETH => envoyer juste ce qu'il manque pour atteindre 0.5
//
// À lancer via cron toutes les 15 minutes par exemple.
// ⚠️ À n'utiliser que sur testnet / dev ⚠️

import { JsonRpcProvider, Wallet, formatEther, parseEther } from "ethers";
import { PRIVATE_KEYS } from "./wallets.js";

// RPC fourni
const RPC_URL = "https://atlantic.dplabs-internal.com";

// Clé du "master" qui envoie les fonds
const MASTER_PRIVATE_KEY =
  "0xe12f9b03327a875c2d5bf9b40a75cd2effeed46ea508ee595c6bc708c386da8c";

// Seuil cible: 0.5 ETH
const THRESHOLD = parseEther("0.5"); // BigInt 5e17

async function main() {
  const provider = new JsonRpcProvider(RPC_URL);
  const master = new Wallet(MASTER_PRIVATE_KEY, provider);

  const network = await provider.getNetwork();
  console.log("Network chainId:", Number(network.chainId));
  console.log("Master address :", master.address);

  let masterBalance = await provider.getBalance(master.address);
  console.log(
    "Master balance :",
    formatEther(masterBalance),
    "(native token)"
  );

  if (masterBalance <= THRESHOLD) {
    console.warn(
      "⚠️ Master balance <= 0.5, attention, tu risques de ne pas pouvoir remplir tout le monde."
    );
  }

  console.log("Nb wallets à vérifier :", PRIVATE_KEYS.length);
  console.log("Seuil par wallet       :", formatEther(THRESHOLD), "ETH");
  console.log("─────────────────────────────────────────────────────");

  for (let i = 0; i < PRIVATE_KEYS.length; i++) {
    const pk = PRIVATE_KEYS[i];
    const wallet = new Wallet(pk, provider);
    const addr = wallet.address;

    const balance = await provider.getBalance(addr);
    console.log(
      `[${i}] ${addr} -> balance = ${formatEther(balance)} (native)`
    );

    if (balance >= THRESHOLD) {
      console.log(`   ✅ >= 0.5, rien à envoyer.`);
      continue;
    }

    const missing = THRESHOLD - balance;
    console.log(
      `   ⚠️ < 0.5, il manque ${formatEther(missing)} pour atteindre 0.5`
    );

    // Vérifier si le master a assez de fonds pour envoyer "missing"
    masterBalance = await provider.getBalance(master.address);
    if (masterBalance <= missing) {
      console.error(
        `   ❌ Master n'a pas assez de fonds pour envoyer ${formatEther(
          missing
        )}. Balance master = ${formatEther(masterBalance)}`
      );
      continue;
    }

    try {
      console.log(
        `   → Envoi de ${formatEther(missing)} depuis ${master.address} vers ${addr}...`
      );
      const tx = await master.sendTransaction({
        to: addr,
        value: missing
      });
      console.log(`   Tx hash: ${tx.hash}`);
      const receipt = await tx.wait();
      console.log(
        `   ✓ Tx minée dans le bloc ${receipt.blockNumber} pour le wallet [${i}]`
      );
    } catch (err) {
      console.error(
        `   ❌ Erreur lors de l'envoi pour [${i}] ${addr}:`,
        err.reason || err.message || err
      );
    }

    console.log("─────────────────────────────────────────────────────");
  }

  console.log("✅ Script terminé.");
}

main().catch((err) => {
  console.error("Erreur fatale dans fund-wallets.js:", err);
  process.exit(1);
});
