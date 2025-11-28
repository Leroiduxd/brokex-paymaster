// server.js
// Brokex MetaRelayer HTTP API (local) avec rotation de wallets
//
// Endpoints (POST, JSON):
//  - /open          -> executeOpenMarket (proof via API)
//  - /close         -> executeCloseMarket (proof via API)
//  - /limit         -> executeOpenLimit
//  - /cancel        -> executeCancelLimit
//  - /set-sl        -> executeSetSL
//  - /set-tp        -> executeSetTP
//  - /update-stops  -> executeUpdateStops
//
// ⚠️ Clés privées dans wallets.js = UNIQUEMENT POUR TESTNET ⚠️

import express from "express";
import cors from "cors"; // <-- NOUVEL IMPORT DE CORS
import { JsonRpcProvider, Wallet, Contract } from "ethers";
import { ABI } from "./abi.js";
import { PRIVATE_KEYS, getPrivateKeyAt, getWalletCount } from "./wallets.js";

// ─────────────────────── Config ───────────────────────

const PORT = process.env.PORT || 8232;

const RPC_URL =
  process.env.RPC_URL || "https://atlantic.dplabs-internal.com";

const CONTRACT_ADDRESS = "0x32da95857ea09Ec3347B59C4869f0D076E6a2957";
const PROOF_API_BASE = "https://backend.brokex.trade/proof?pairs=";

// Provider partagé
const provider = new JsonRpcProvider(RPC_URL);

// Index actuel pour le round-robin
let currentWalletIndex = 0;

// ─────────────────────── Helpers ───────────────────────

async function fetchProof(assetId) {
  const url = PROOF_API_BASE + encodeURIComponent(String(assetId));
  console.log(`→ Fetching proof from: ${url}`);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Proof API error: HTTP ${res.status}`);
  }
  const data = await res.json();
  if (!data || !data.proof) {
    throw new Error(`Proof API error: 'proof' field missing in response`);
  }
  console.log(`✓ Proof received (length=${data.proof.length})`);
  return data.proof;
}

function parseBool(v, defaultVal = false) {
  if (v === undefined || v === null) return defaultVal;
  if (typeof v === "boolean") return v;
  const s = String(v).toLowerCase();
  return s === "true" || s === "1" || s === "yes" || s === "y";
}

function ok(res, data) {
  res.json({ ok: true, ...data });
}

function fail(res, error) {
  console.error(error);
  const message =
    error?.reason || error?.message || error?.toString() || "Unknown error";
  res.status(500).json({ ok: false, error: message });
}

// Détection "insufficient funds"
function isInsufficientFundsError(err) {
  const msg = (err?.reason || err?.message || "").toLowerCase();
  return (
    err?.code === "INSUFFICIENT_FUNDS" ||
    msg.includes("insufficient funds") ||
    msg.includes("insufficient balance for transaction")
  );
}

// Fonction générique : envoie une tx en testant les wallets en rotation
async function sendTxWithWalletRotation(sendTxFn) {
  const total = getWalletCount();
  if (total === 0) {
    throw new Error("No private keys configured");
  }

  for (let attempt = 0; attempt < total; attempt++) {
    const idx = (currentWalletIndex + attempt) % total;
    const pk = getPrivateKeyAt(idx);
    const wallet = new Wallet(pk, provider);
    const contract = new Contract(CONTRACT_ADDRESS, ABI, wallet);

    console.log(
      `→ Trying wallet index=${idx}, address=${wallet.address} (attempt ${
        attempt + 1
      }/${total})`
    );

    try {
      // sendTxFn doit renvoyer { tx, context? }
      const { tx, context } = await sendTxFn(contract, wallet, idx);
      console.log("Tx hash:", tx.hash);
      const receipt = await tx.wait();
      console.log("✓ Tx mined in block", receipt.blockNumber);

      // Avancer le round-robin pour la prochaine requête,
      // à partir du wallet qui vient de signer.
      currentWalletIndex = (idx + 1) % total;

      return {
        tx,
        receipt,
        walletIndex: idx,
        walletAddress: wallet.address,
        context
      };
    } catch (err) {
      if (isInsufficientFundsError(err)) {
        console.warn(
          `⚠️ Wallet index=${idx} (${wallet.address}) has insufficient funds, trying next...`
        );
        // On continue la boucle -> test du wallet suivant
        continue;
      }
      // Erreur autre que manque de gaz : on arrête
      throw err;
    }
  }

  throw new Error(
    "All wallets failed (likely insufficient funds on all configured private keys)"
  );
}

// ─────────────────────── Express app ───────────────────────

const app = express();
app.use(cors()); // <-- UTILISATION DE CORS POUR TOUTES LES ROUTES
app.use(express.json());

// Healthcheck simple
app.get("/", (_, res) => {
  res.send("Brokex MetaRelayer API (rotating wallets) is running ✅");
});

// ─────────────────────── Routes ───────────────────────

// 1) OPEN MARKET (avec proof)
app.post("/open", async (req, res) => {
  try {
    const {
      trader,
      assetId,
      longSide,
      leverageX,
      lots,
      slX6,
      tpX6,
      deadline,
      signature
    } = req.body;

    if (!signature) throw new Error("Missing 'signature' in body");
    if (assetId === undefined) throw new Error("Missing 'assetId' in body");
    if (!deadline) throw new Error("Missing 'deadline' in body");

    const assetIdNum = Number(assetId);
    const longSideBool = parseBool(longSide, true);
    const leverageXNum = Number(leverageX || 0);
    const lotsNum = Number(lots || 0);
    const slX6Val = slX6 ?? "0";
    const tpX6Val = tpX6 ?? "0";
    const deadlineVal = String(deadline);

    console.log("=== /open ===");
    console.log({
      traderOverride: trader,
      assetId: assetIdNum,
      longSide: longSideBool,
      leverageX: leverageXNum,
      lots: lotsNum,
      slX6: slX6Val,
      tpX6: tpX6Val,
      deadline: deadlineVal
    });

    const proof = await fetchProof(assetIdNum);

    const result = await sendTxWithWalletRotation(async (contract, wallet) => {
      const finalTrader = trader || wallet.address;
      console.log("Using trader address:", finalTrader);

      const tx = await contract.executeOpenMarket(
        finalTrader,
        proof,
        assetIdNum,
        longSideBool,
        leverageXNum,
        lotsNum,
        slX6Val,
        tpX6Val,
        deadlineVal,
        signature
      );

      return {
        tx,
        context: { trader: finalTrader, assetId: assetIdNum }
      };
    });

    ok(res, {
      txHash: result.tx.hash,
      blockNumber: result.receipt.blockNumber,
      walletIndex: result.walletIndex,
      walletAddress: result.walletAddress,
      context: result.context
    });
  } catch (err) {
    fail(res, err);
  }
});

// 2) CLOSE MARKET (avec proof)
app.post("/close", async (req, res) => {
  try {
    const { trader, positionId, id, assetId, deadline, signature } = req.body;

    if (!signature) throw new Error("Missing 'signature' in body");
    if (assetId === undefined) throw new Error("Missing 'assetId' in body");
    if (deadline === undefined) throw new Error("Missing 'deadline' in body");

    const posId = Number(positionId ?? id ?? 0);
    const assetIdNum = Number(assetId);
    const deadlineVal = String(deadline);

    console.log("=== /close ===");
    console.log({
      traderOverride: trader,
      positionId: posId,
      assetId: assetIdNum,
      deadline: deadlineVal
    });

    const proof = await fetchProof(assetIdNum);

    const result = await sendTxWithWalletRotation(async (contract, wallet) => {
      const finalTrader = trader || wallet.address;
      console.log("Using trader address:", finalTrader);

      const tx = await contract.executeCloseMarket(
        finalTrader,
        posId,
        proof,
        deadlineVal,
        signature
      );

      return {
        tx,
        context: { trader: finalTrader, positionId: posId, assetId: assetIdNum }
      };
    });

    ok(res, {
      txHash: result.tx.hash,
      blockNumber: result.receipt.blockNumber,
      walletIndex: result.walletIndex,
      walletAddress: result.walletAddress,
      context: result.context
    });
  } catch (err) {
    fail(res, err);
  }
});

// 3) OPEN LIMIT (sans proof)
app.post("/limit", async (req, res) => {
  try {
    const {
      trader,
      assetId,
      longSide,
      leverageX,
      lots,
      targetX6,
      slX6,
      tpX6,
      deadline,
      signature
    } = req.body;

    if (!signature) throw new Error("Missing 'signature' in body");
    if (assetId === undefined) throw new Error("Missing 'assetId' in body");
    if (deadline === undefined) throw new Error("Missing 'deadline' in body");

    const assetIdNum = Number(assetId);
    const longSideBool = parseBool(longSide, true);
    const leverageXNum = Number(leverageX || 0);
    const lotsNum = Number(lots || 0);
    const targetX6Val = targetX6 ?? "0";
    const slX6Val = slX6 ?? "0";
    const tpX6Val = tpX6 ?? "0";
    const deadlineVal = String(deadline);

    console.log("=== /limit ===");
    console.log({
      traderOverride: trader,
      assetId: assetIdNum,
      longSide: longSideBool,
      leverageX: leverageXNum,
      lots: lotsNum,
      targetX6: targetX6Val,
      slX6: slX6Val,
      tpX6: tpX6Val,
      deadline: deadlineVal
    });

    const result = await sendTxWithWalletRotation(async (contract, wallet) => {
      const finalTrader = trader || wallet.address;
      console.log("Using trader address:", finalTrader);

      const tx = await contract.executeOpenLimit(
        finalTrader,
        assetIdNum,
        longSideBool,
        leverageXNum,
        lotsNum,
        targetX6Val,
        slX6Val,
        tpX6Val,
        deadlineVal,
        signature
      );

      return {
        tx,
        context: { trader: finalTrader, assetId: assetIdNum }
      };
    });

    ok(res, {
      txHash: result.tx.hash,
      blockNumber: result.receipt.blockNumber,
      walletIndex: result.walletIndex,
      walletAddress: result.walletAddress,
      context: result.context
    });
  } catch (err) {
    fail(res, err);
  }
});

// 4) CANCEL LIMIT
app.post("/cancel", async (req, res) => {
  try {
    const { trader, id, positionId, deadline, signature } = req.body;

    if (!signature) throw new Error("Missing 'signature' in body");
    if (deadline === undefined) throw new Error("Missing 'deadline' in body");

    const orderId = Number(id ?? positionId ?? 0);
    const deadlineVal = String(deadline);

    console.log("=== /cancel ===");
    console.log({
      traderOverride: trader,
      id: orderId,
      deadline: deadlineVal
    });

    const result = await sendTxWithWalletRotation(async (contract, wallet) => {
      const finalTrader = trader || wallet.address;
      console.log("Using trader address:", finalTrader);

      const tx = await contract.executeCancelLimit(
        finalTrader,
        orderId,
        deadlineVal,
        signature
      );

      return {
        tx,
        context: { trader: finalTrader, id: orderId }
      };
    });

    ok(res, {
      txHash: result.tx.hash,
      blockNumber: result.receipt.blockNumber,
      walletIndex: result.walletIndex,
      walletAddress: result.walletAddress,
      context: result.context
    });
  } catch (err) {
    fail(res, err);
  }
});

// 5) SET SL
app.post("/set-sl", async (req, res) => {
  try {
    const { trader, id, positionId, newSLx6, deadline, signature } = req.body;

    if (!signature) throw new Error("Missing 'signature' in body");
    if (deadline === undefined) throw new Error("Missing 'deadline' in body");
    if (newSLx6 === undefined) throw new Error("Missing 'newSLx6' in body");

    const posId = Number(id ?? positionId ?? 0);
    const newSLx6Val = String(newSLx6);
    const deadlineVal = String(deadline);

    console.log("=== /set-sl ===");
    console.log({
      traderOverride: trader,
      id: posId,
      newSLx6: newSLx6Val,
      deadline: deadlineVal
    });

    const result = await sendTxWithWalletRotation(async (contract, wallet) => {
      const finalTrader = trader || wallet.address;
      console.log("Using trader address:", finalTrader);

      const tx = await contract.executeSetSL(
        finalTrader,
        posId,
        newSLx6Val,
        deadlineVal,
        signature
      );

      return {
        tx,
        context: { trader: finalTrader, id: posId, newSLx6: newSLx6Val }
      };
    });

    ok(res, {
      txHash: result.tx.hash,
      blockNumber: result.receipt.blockNumber,
      walletIndex: result.walletIndex,
      walletAddress: result.walletAddress,
      context: result.context
    });
  } catch (err) {
    fail(res, err);
  }
});

// 6) SET TP
app.post("/set-tp", async (req, res) => {
  try {
    const { trader, id, positionId, newTPx6, deadline, signature } = req.body;

    if (!signature) throw new Error("Missing 'signature' in body");
    if (deadline === undefined) throw new Error("Missing 'deadline' in body");
    if (newTPx6 === undefined) throw new Error("Missing 'newTPx6' in body");

    const posId = Number(id ?? positionId ?? 0);
    const newTPx6Val = String(newTPx6);
    const deadlineVal = String(deadline);

    console.log("=== /set-tp ===");
    console.log({
      traderOverride: trader,
      id: posId,
      newTPx6: newTPx6Val,
      deadline: deadlineVal
    });

    const result = await sendTxWithWalletRotation(async (contract, wallet) => {
      const finalTrader = trader || wallet.address;
      console.log("Using trader address:", finalTrader);

      const tx = await contract.executeSetTP(
        finalTrader,
        posId,
        newTPx6Val,
        deadlineVal,
        signature
      );

      return {
        tx,
        context: { trader: finalTrader, id: posId, newTPx6: newTPx6Val }
      };
    });

    ok(res, {
      txHash: result.tx.hash,
      blockNumber: result.receipt.blockNumber,
      walletIndex: result.walletIndex,
      walletAddress: result.walletAddress,
      context: result.context
    });
  } catch (err) {
    fail(res, err);
  }
});

// 7) UPDATE STOPS (SL + TP)
app.post("/update-stops", async (req, res) => {
  try {
    const {
      trader,
      id,
      positionId,
      newSLx6,
      newTPx6,
      deadline,
      signature
    } = req.body;

    if (!signature) throw new Error("Missing 'signature' in body");
    if (deadline === undefined) throw new Error("Missing 'deadline' in body");
    if (newSLx6 === undefined) throw new Error("Missing 'newSLx6' in body");
    if (newTPx6 === undefined) throw new Error("Missing 'newTPx6' in body");

    const posId = Number(id ?? positionId ?? 0);
    const newSLx6Val = String(newSLx6);
    const newTPx6Val = String(newTPx6);
    const deadlineVal = String(deadline);

    console.log("=== /update-stops ===");
    console.log({
      traderOverride: trader,
      id: posId,
      newSLx6: newSLx6Val,
      newTPx6: newTPx6Val,
      deadline: deadlineVal
    });

    const result = await sendTxWithWalletRotation(async (contract, wallet) => {
      const finalTrader = trader || wallet.address;
      console.log("Using trader address:", finalTrader);

      const tx = await contract.executeUpdateStops(
        finalTrader,
        posId,
        newSLx6Val,
        newTPx6Val,
        deadlineVal,
        signature
      );

      return {
        tx,
        context: {
          trader: finalTrader,
          id: posId,
          newSLx6: newSLx6Val,
          newTPx6: newTPx6Val
        }
      };
    });

    ok(res, {
      txHash: result.tx.hash,
      blockNumber: result.receipt.blockNumber,
      walletIndex: result.walletIndex,
      walletAddress: result.walletAddress,
      context: result.context
    });
  } catch (err) {
    fail(res, err);
  }
});

// ─────────────────────── Start ───────────────────────

async function start() {
  const net = await provider.getNetwork();
  console.log("Connected to chainId:", Number(net.chainId));
  console.log("Contract           :", CONTRACT_ADDRESS);
  console.log("Wallets configured :", getWalletCount());

  // Afficher l'adresse du premier wallet pour debug
  const firstPk = getPrivateKeyAt(0);
  const firstWallet = new Wallet(firstPk, provider);
  console.log("First wallet       :", firstWallet.address);

  app.listen(PORT, () => {
    console.log(`MetaRelayer API listening on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
