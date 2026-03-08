/**
 * Copyright 2025 Anoop Garlapati and RuneKit Contributors
 * Copyright 2026 StepSecurity
 * Licensed under the Apache License, Version 2.0 – see LICENSE in the root of this repository.
 */
import * as core from "@actions/core";
import * as github from "@actions/github";
import axios, { isAxiosError } from "axios";
import { loadConfig } from "./config";
import { parseTestNGResult } from "./testng-parser";
import { createAnnotationsForFailedTests } from "./annotations";
import {
  generateSummaryStats,
  generateSummaryMarkdown,
} from "./report-summary";
import {
  generateDetailedMarkdown,
  generateDetailedMarkdownFailedOnly,
} from "./report-detailed";
import * as fs from "fs";
import * as glob from "glob";

async function validateSubscription() {
  const repoPrivate = github.context?.payload?.repository?.private;
  const upstream = "runekit-oss/action-testng-report";
  const action = process.env.GITHUB_ACTION_REPOSITORY;
  const docsUrl =
    "https://docs.stepsecurity.io/actions/stepsecurity-maintained-actions";

  core.info("");
  core.info("\u001b[1;36mStepSecurity Maintained Action\u001b[0m");
  core.info(`Secure drop-in replacement for ${upstream}`);
  if (repoPrivate === false)
    core.info("\u001b[32m\u2713 Free for public repositories\u001b[0m");
  core.info(`\u001b[36mLearn more:\u001b[0m ${docsUrl}`);
  core.info("");

  if (repoPrivate === false) return;

  const serverUrl = process.env.GITHUB_SERVER_URL || "https://github.com";
  const body: Record<string, string> = { action: action || "" };
  if (serverUrl !== "https://github.com") body.ghes_server = serverUrl;
  try {
    await axios.post(
      `https://agent.api.stepsecurity.io/v1/github/${process.env.GITHUB_REPOSITORY}/actions/maintained-actions-subscription`,
      body,
      { timeout: 3000 },
    );
  } catch (error) {
    if (isAxiosError(error) && error.response?.status === 403) {
      core.error(
        `\u001b[1;31mThis action requires a StepSecurity subscription for private repositories.\u001b[0m`,
      );
      core.error(
        `\u001b[31mLearn how to enable a subscription: ${docsUrl}\u001b[0m`,
      );
      process.exit(1);
    }
    core.info("Timeout or API not reachable. Continuing to next step.");
  }
}

async function run() {
  try {
    await validateSubscription();
    const config = loadConfig();
    const files = glob.sync(config.reportPaths);
    if (files.length === 0) {
      const msg = `No TestNG report files found for pattern: ${config.reportPaths}`;
      if (config.failIfEmpty) {
        core.setFailed(msg);
      } else {
        core.warning(msg);
      }
      return;
    }
    let allSuites: ReturnType<typeof parseTestNGResult> = [];
    for (const file of files) {
      const xml = fs.readFileSync(file, "utf-8");
      const suites = parseTestNGResult(xml);
      allSuites = allSuites.concat(suites);
    }
    // Optionally use check_name for future check run integration (placeholder)
    core.info(`Check name: ${config.checkName}`);
    createAnnotationsForFailedTests(allSuites);

    // Build summary content
    let summaryContent = "";
    let detailedContent = "";

    if (config.summaryReport) {
      const stats = generateSummaryStats(allSuites);
      summaryContent = generateSummaryMarkdown(stats);
    }

    // Build detailed report content
    if (config.detailedReport) {
      detailedContent = generateDetailedMarkdown(allSuites);
    }

    // Check if the combined output exceeds GitHub's 1024KB limit
    const MAX_SIZE_BYTES = 1024 * 1024; // 1024KB
    let combinedContent = summaryContent + detailedContent;
    const contentSizeBytes = Buffer.byteLength(combinedContent, "utf8");

    if (contentSizeBytes > MAX_SIZE_BYTES && config.detailedReport) {
      core.info(
        `Report size (${contentSizeBytes} bytes) exceeds GitHub limit (${MAX_SIZE_BYTES} bytes). Truncating detailed report to show only failed tests.`,
      );
      // Regenerate detailed report with only failed tests
      detailedContent = generateDetailedMarkdownFailedOnly(allSuites);
      combinedContent = summaryContent + detailedContent;

      const newSizeBytes = Buffer.byteLength(combinedContent, "utf8");
      core.info(`Truncated report size: ${newSizeBytes} bytes`);

      if (newSizeBytes > MAX_SIZE_BYTES) {
        core.warning(
          `Even after truncation, report size (${newSizeBytes} bytes) still exceeds GitHub limit. Some content may be cut off.`,
        );
      }
    }

    // Add content to summary
    if (summaryContent) {
      core.summary.addRaw(summaryContent);
    }
    if (detailedContent) {
      core.summary.addRaw(detailedContent);
    }

    // Write summary only once at the end
    if (config.summaryReport || config.detailedReport) {
      await core.summary.write();
    }
  } catch (error: unknown) {
    if (error && typeof error === "object" && "message" in error) {
      core.setFailed((error as { message?: string }).message || String(error));
    } else {
      core.setFailed(String(error));
    }
  }
}

run();
