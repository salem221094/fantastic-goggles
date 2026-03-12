import * as wmill from 'npm:windmill-client@1.253.7';
import { GoogleGenerativeAI, SchemaType } from "npm:@google/generative-ai@0.21.0";
import { parse } from "https://deno.land/std@0.208.0/csv/parse.ts";

/**
 * @param {string} apiKey - The Gemini API Key
 */
export async function main(apiKey: string) {
    // 1. Read skills_en.csv from Windmill storage
    const fileContent = await wmill.loadS3File({ s3: 'skills_en.csv' });
    const text = new TextDecoder().decode(fileContent);

    // 2. Parse CSV
    const rows = parse(text, {
        skipFirstRow: true,
        columns: [
            "conceptType", "conceptUri", "skillType", "reuseLevel", "preferredLabel",
            "altLabels", "hiddenLabels", "status", "modifiedDate", "scopeNote",
            "definition", "inScheme", "description"
        ],
    }) as Record<string, string>[];

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: "gemini-3.1-flash-lite-preview",
        generationConfig: {
            responseMimeType: "application/json",
            responseSchema: {
                type: SchemaType.OBJECT,
                properties: {
                    score: {
                        type: SchemaType.NUMBER,
                        description: "The relevance score (1, 0.5, or 0)",
                    },
                },
                required: ["score"],
            },
        },
    });

    const results = [];

    for (const row of rows) {
        const prompt = `Score the following skill based on its relevance:
        Label: ${row.preferredLabel}
        Description: ${row.description}

        Return a JSON object with a 'score' field (1, 0.5, or 0).`;

        try {
            const result = await model.generateContent(prompt);
            const response = await result.response;
            const responseText = response.text();
            const jsonResponse = JSON.parse(responseText);

            results.push({
                conceptUri: row.conceptUri,
                preferredLabel: row.preferredLabel,
                score: jsonResponse.score
            });

            console.log(`Scored ${row.preferredLabel}: ${jsonResponse.score}`);

        } catch (error) {
            console.error(`Error scoring ${row.preferredLabel}:`, error);
            results.push({
                conceptUri: row.conceptUri,
                preferredLabel: row.preferredLabel,
                score: null,
                error: (error as Error).message
            });
        }

        // Strict 4500ms delay to respect rate limits
        await new Promise(r => setTimeout(r, 4500));
    }

    // 3. Write results back to Windmill storage
    const outputFileName = 'scored_skills.json';
    const outputContent = JSON.stringify(results, null, 2);
    await wmill.writeS3File({ s3: outputFileName }, outputContent);

    return results; // Return the array as the script's visual output
}
