// One-time seed script for the Phase 5 demo account. Uploads the 12
// demo-data invoices (demo-data/manifest.json) to Storage as the real demo
// user, enqueues them, runs them through the exact same extraction pipeline
// the deployed worker uses (claim_next_document -> processDocument, imported
// from worker/dist so this is the real compiled code, never reimplemented),
// corrects any genuinely flagged fields with the known-correct values from
// the manifest (never fabricated — these are the same values the ground-
// truth fixture and demo invoices were generated from), and approves a
// curated subset. The rest are deliberately left in needs_review, fully
// corrected and ready to approve, so a portfolio visitor can see — and
// click through — the review step themselves rather than only ever seeing
// a fully-approved dataset.
//
// Requires real network access to this Supabase project's Storage and REST
// APIs. The sandbox this project was originally built in has no route to
// either (see WORKFLOW.md's Phase 5 decisions log) — run this from a
// machine with normal network access, or during Phase 6's deployment.
//
// MUST run before organizations.is_demo is flipped to true for the demo
// org: approve_document() needs a genuinely writable org to record a real
// approved_by, and once is_demo is true, is_writable_org_member() blocks
// every write this script makes (uploads, enqueue, corrections, approval).
//
// Usage (from worker/):
//   npm run build
//   SUPABASE_URL=... \
//   SUPABASE_ANON_KEY=... \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   ANTHROPIC_API_KEY=... \
//     node scripts/seed-demo.mjs
//
// SUPABASE_ANON_KEY is the same value as the app's
// NEXT_PUBLIC_SUPABASE_ANON_KEY (Project Settings > API) — this script
// reads either name. SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY/
// ANTHROPIC_API_KEY are the same values worker/.env.example already
// documents for the deployed worker.

import { createClient } from "@supabase/supabase-js";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { supabase as serviceClient } from "../dist/supabase.js";
import { claimNextDocument } from "../dist/claim.js";
import { processDocument } from "../dist/process.js";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEMO_DATA_DIR = path.join(SCRIPT_DIR, "..", "..", "demo-data");

// Matches the row created live and recorded in WORKFLOW.md's Phase 5
// decisions log. Not a secret — these are meant to be publicly visible on
// the login screen.
const DEMO_EMAIL = "demo@docextractor.example";
const DEMO_PASSWORD = "DemoInvoice2026!";

// Left in needs_review on purpose: the skewed scan and missing-PO cases
// (so a visitor sees exactly the scenarios Phase 5's own checklist calls
// out), the "Due on receipt" non-calendar due-date edge case, and one of
// the two brand-new (never-seen-in-ground-truth) invoices. Everything else
// gets approved. All 12 are corrected first regardless of this split —
// this only decides which ones this script itself clicks "Approve" on.
const LEAVE_IN_REVIEW = new Set(["riverbend-02", "riverbend-03", "marrowfinch-03", "cobalt-04"]);

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error(
    "SUPABASE_URL and SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY) must be set",
  );
}

async function main() {
  const manifest = JSON.parse(await readFile(path.join(DEMO_DATA_DIR, "manifest.json"), "utf8"));
  const manifestById = new Map(manifest.documents.map((doc) => [doc.id, doc]));

  const authClient = createClient(url, anonKey);
  const { data: signIn, error: signInError } = await authClient.auth.signInWithPassword({
    email: DEMO_EMAIL,
    password: DEMO_PASSWORD,
  });
  if (signInError || !signIn.user) {
    throw new Error(`demo sign-in failed: ${signInError?.message ?? "no user returned"}`);
  }
  const demoUserId = signIn.user.id;

  const { data: membership, error: membershipError } = await authClient
    .from("memberships")
    .select("org_id")
    .eq("user_id", demoUserId)
    .single();
  if (membershipError || !membership) {
    throw new Error(`no membership found for demo user: ${membershipError?.message ?? "none"}`);
  }
  const orgId = membership.org_id;

  const { data: template, error: templateError } = await authClient
    .from("extraction_templates")
    .select("id")
    .eq("org_id", orgId)
    .eq("name", "Invoices")
    .single();
  if (templateError || !template) {
    throw new Error(
      `no "Invoices" template found for demo org: ${templateError?.message ?? "none"}`,
    );
  }
  const templateId = template.id;

  console.log(
    `[seed] demo org ${orgId}, template ${templateId}, ${manifest.documents.length} documents`,
  );

  // --- Upload + enqueue, as the real demo user — the same path the
  // browser's upload form takes (src/app/documents/upload-form.tsx,
  // actions.ts): Storage upload, documents insert, then the
  // uploaded -> queued status update. ---
  const documentIds = [];
  for (const doc of manifest.documents) {
    const filePath = path.join(DEMO_DATA_DIR, doc.path);
    const bytes = await readFile(filePath);
    const fileHash = createHash("sha256").update(bytes).digest("hex");
    const storagePath = `${orgId}/${randomUUID()}-${path.basename(doc.path)}`;

    const { error: uploadError } = await authClient.storage
      .from("documents")
      .upload(storagePath, bytes, { contentType: doc.mime_type });
    if (uploadError) {
      throw new Error(`upload failed for ${doc.id}: ${uploadError.message}`);
    }

    const { data: inserted, error: insertError } = await authClient
      .from("documents")
      .insert({
        org_id: orgId,
        template_id: templateId,
        original_filename: path.basename(doc.path),
        storage_path: storagePath,
        file_hash: fileHash,
        mime_type: doc.mime_type,
      })
      .select("id")
      .single();
    if (insertError) {
      throw new Error(`document insert failed for ${doc.id}: ${insertError.message}`);
    }

    const { error: enqueueError } = await authClient
      .from("documents")
      .update({ status: "queued" })
      .eq("id", inserted.id);
    if (enqueueError) {
      throw new Error(`enqueue failed for ${doc.id}: ${enqueueError.message}`);
    }

    documentIds.push({ manifestId: doc.id, documentId: inserted.id });
    console.log(`[seed] uploaded + queued ${doc.id} -> ${inserted.id}`);
  }

  // --- Real extraction, via the exact claim + process path the deployed
  // worker uses (worker/src/tick.ts's own logic, inlined here so a failure
  // on one document is caught and marked 'failed' without stopping the
  // rest of the seed run — same reasoning as tick.ts itself). ---
  let claimed = 0;
  for (;;) {
    const document = await claimNextDocument();
    if (!document) break;
    claimed++;
    try {
      await processDocument(document);
      console.log(`[seed] processed ${document.id} (${document.original_filename})`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[seed] FAILED processing ${document.id}: ${message}`);
      await serviceClient
        .from("documents")
        .update({ status: "failed", error_message: message })
        .eq("id", document.id);
    }
  }
  console.log(`[seed] claimed/processed ${claimed} documents`);

  // --- Correct any genuinely flagged fields with the known-correct values
  // from manifest.json. Mirrors approve_document()'s own gate exactly
  // (final_confidence < 0.9 and not was_corrected) and saveCorrection()'s
  // own update shape (src/app/documents/[id]/actions.ts). ---
  for (const { manifestId, documentId } of documentIds) {
    const knownFields = manifestById.get(manifestId).fields;

    const { data: flagged, error: flaggedError } = await serviceClient
      .from("extracted_fields")
      .select("field_key")
      .eq("document_id", documentId)
      .lt("final_confidence", 0.9)
      .eq("was_corrected", false);
    if (flaggedError) {
      throw new Error(`failed to read flagged fields for ${manifestId}: ${flaggedError.message}`);
    }

    for (const field of flagged ?? []) {
      const knownValue = knownFields[field.field_key];
      if (knownValue === null || knownValue === undefined) {
        console.log(
          `[seed] ${manifestId}.${field.field_key} flagged, but has no known-correct value ` +
            `(genuinely absent on this invoice) — leaving it flagged`,
        );
        continue;
      }

      const { error: correctError } = await authClient
        .from("extracted_fields")
        .update({
          was_corrected: true,
          corrected_value: knownValue,
          corrected_by: demoUserId,
          corrected_at: new Date().toISOString(),
        })
        .eq("document_id", documentId)
        .eq("field_key", field.field_key);
      if (correctError) {
        throw new Error(
          `correction failed for ${manifestId}.${field.field_key}: ${correctError.message}`,
        );
      }
      console.log(`[seed] corrected ${manifestId}.${field.field_key}`);
    }
  }

  // --- Approve everything except the curated LEAVE_IN_REVIEW set ---
  let approvedCount = 0;
  for (const { manifestId, documentId } of documentIds) {
    if (LEAVE_IN_REVIEW.has(manifestId)) {
      console.log(`[seed] leaving ${manifestId} in needs_review`);
      continue;
    }

    const { error: approveError } = await authClient.rpc("approve_document", {
      p_document_id: documentId,
    });
    if (approveError) {
      console.error(`[seed] could not approve ${manifestId}: ${approveError.message}`);
      continue;
    }
    approvedCount++;
    console.log(`[seed] approved ${manifestId}`);
  }

  console.log(
    `\n[seed] done: ${documentIds.length} uploaded, ${claimed} processed, ` +
      `${approvedCount} approved, ${documentIds.length - approvedCount} left in needs_review.`,
  );
  console.log(
    `\n[seed] Next step (manual, on purpose): open the app, spot-check the demo org's ` +
      `documents look right, then lock it read-only:\n` +
      `  update organizations set is_demo = true where id = '${orgId}';`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
