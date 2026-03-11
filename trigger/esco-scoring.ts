import { task, wait, logger } from "@trigger.dev/sdk/v3";
import { GoogleGenAI } from "@google/genai";
import * as fs from "fs";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import * as path from "path";

const genAI = new GoogleGenAI({
  apiKey: process.env.GOOGLE_GENAI_API_KEY || "",
});

const schema = {
  type: "object",
  properties: {
    score: {
      type: "number",
      description: "The time-saving score for the task. Strictly 1, 0.5, or 0.",
    },
  },
  required: ["score"],
};

interface SkillRow {
  conceptUri: string;
  preferredLabel: string;
  description?: string;
  definition?: string;
  [key: string]: any;
}

export const escoScoringTask = task({
  id: "esco-scoring",
  run: async (payload: { limit?: number }) => {
    const skillsFilePath = path.join(process.cwd(), "skills_en.csv");
    const scoredFilePath = path.join(process.cwd(), "data", "scored_skills.csv");

    // Ensure data directory exists
    if (!fs.existsSync(path.dirname(scoredFilePath))) {
      fs.mkdirSync(path.dirname(scoredFilePath), { recursive: true });
    }

    // Load already scored skills
    const scoredUris = new Set<string>();
    if (fs.existsSync(scoredFilePath) && fs.statSync(scoredFilePath).size > 0) {
      const scoredContent = fs.readFileSync(scoredFilePath, "utf-8");
      try {
        const scoredRecords = parse(scoredContent, {
          columns: true,
          skip_empty_lines: true,
        }) as any[];
        for (const record of scoredRecords) {
          if (record.conceptUri) {
            scoredUris.add(record.conceptUri);
          }
        }
      } catch (e) {
        logger.error("Error parsing scored_skills.csv", { error: (e as any).message });
      }
    }

    // If file doesn't exist or is empty, write header
    if (!fs.existsSync(scoredFilePath) || fs.statSync(scoredFilePath).size === 0) {
      fs.writeFileSync(scoredFilePath, "conceptUri,preferredLabel,score\n");
    }

    // Read skills CSV
    if (!fs.existsSync(skillsFilePath)) {
       throw new Error(`Skills file not found at ${skillsFilePath}`);
    }
    const skillsContent = fs.readFileSync(skillsFilePath, "utf-8");
    const skills = parse(skillsContent, {
      columns: true,
      skip_empty_lines: true,
    }) as SkillRow[];

    logger.info(`Total skills: ${skills.length}. Already scored: ${scoredUris.size}`);

    let processedCount = 0;
    for (const skill of skills) {
      if (payload.limit && processedCount >= payload.limit) break;
      if (scoredUris.has(skill.conceptUri)) continue;

      const prompt = `"Can an LLM reduce the time it takes a human to perform this task by 50% without a drop in quality? Score it based on current AI capabilities."

Task Name: ${skill.preferredLabel}
Task Description: ${skill.description || skill.definition || "No description provided."}

Return ONLY a JSON object with a "score" key. The value MUST be strictly 1, 0.5, or 0.`;

      try {
        const response = await genAI.models.generateContent({
          model: "gemini-3.1-flash-lite-preview",
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          config: {
            responseMimeType: "application/json",
            responseSchema: schema,
            // @ts-ignore
            thinkingLevel: "low",
          },
        });

        // @ts-ignore
        const jsonResponse = response.value;
        const score = (jsonResponse as any).score;

        // Append to CSV
        const row = stringify([[skill.conceptUri, skill.preferredLabel, score]]);
        fs.appendFileSync(scoredFilePath, row);

        logger.info(`Scored ${skill.preferredLabel}: ${score}`);
        processedCount++;

        // Rate limiting: 15 RPM = 1 request every 4000ms. 4500ms to be safe.
        await wait.for({ seconds: 4.5 });
      } catch (error) {
        logger.error(`Error scoring ${skill.preferredLabel}: `, { error: (error as any).message });

        if ((error as any).message?.includes("429") || (error as any).status === 429) {
             await wait.for({ seconds: 60 });
        } else {
             await wait.for({ seconds: 5 });
        }
      }
    }

    return { processedCount };
  },
});
