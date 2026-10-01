import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { z } from 'zod';
import {
  DIFFICULTY,
  type Extraction,
  type Profile,
  type RecommendationState,
  type RecommendationTag,
  type Scores,
} from '@app/shared';

// Single provider only: Amazon Bedrock on-demand. No multi-provider abstraction
// (NFR-1.2). The model id is configurable via the BEDROCK_MODEL_ID env var so the
// deployed model can change without code changes (OD stretch B4 deferred).

const client = new BedrockRuntimeClient({});

const MODEL_ID_ENV = 'BEDROCK_MODEL_ID';

const textDecoder = new TextDecoder();

/**
 * Enforced extraction output shape. Validated with Zod; a parse/validation
 * failure drives the bounded retry in {@link bedrockExtract}. Lives in the
 * backend lib (not `@app/shared`) because it is a server-only LLM contract.
 */
export const extractionResponseSchema = z.object({
  topics: z.array(z.string()).max(50),
  concepts: z.array(z.string()).max(100),
  claims: z.array(z.string()).max(50),
  difficulty: z.enum(DIFFICULTY),
  summary: z.string().max(500),
});

export type ExtractionResponse = z.infer<typeof extractionResponseSchema>;

export interface ExtractionRequest {
  text: string; // cleaned readable text, already truncated to 200k by the caller
}

function modelId(): string {
  const id = process.env[MODEL_ID_ENV];
  if (!id) {
    throw new Error(`${MODEL_ID_ENV} env var is not set`);
  }
  return id;
}

/**
 * Invoke the configured Bedrock model with a single user prompt using the
 * Anthropic Messages body shape (the on-demand default), returning the model's
 * raw text output. Kept private: the only entry points are extract/explain.
 */
async function invoke(prompt: string, maxTokens: number): Promise<string> {
  const body = JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: maxTokens,
    temperature: 0,
    messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
  });

  const res = await client.send(
    new InvokeModelCommand({
      modelId: modelId(),
      contentType: 'application/json',
      accept: 'application/json',
      body,
    })
  );

  const payload = JSON.parse(textDecoder.decode(res.body)) as {
    content?: { type?: string; text?: string }[];
  };

  const text = (payload.content ?? [])
    .map((block) => (block.type === 'text' ? (block.text ?? '') : ''))
    .join('')
    .trim();

  if (!text) {
    throw new Error('Bedrock returned an empty response');
  }
  return text;
}

/**
 * Pull a JSON object out of a model response that may be wrapped in prose or a
 * fenced code block, then parse it. Returns `undefined` when nothing parses so
 * the caller can decide to retry.
 */
function parseJsonObject(raw: string): unknown {
  let candidate = raw.trim();

  // Strip a Markdown code fence if the model added one despite instructions.
  const fence = candidate.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    candidate = fence[1].trim();
  }

  // Fall back to the first balanced-looking `{...}` slice.
  if (!candidate.startsWith('{')) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start !== -1 && end > start) {
      candidate = candidate.slice(start, end + 1);
    }
  }

  return JSON.parse(candidate);
}

const EXTRACTION_INSTRUCTIONS = [
  'You analyze a document and extract structured knowledge.',
  'Return ONLY minified JSON (no markdown, no code fence, no prose) with EXACTLY these keys:',
  '{"topics":string[],"concepts":string[],"claims":string[],"difficulty":"INTRO"|"INTERMEDIATE"|"ADVANCED"|"EXPERT","summary":string}',
  'Constraints: topics<=50, concepts<=100, claims<=50, summary<=500 characters.',
  'difficulty MUST be one of INTRO, INTERMEDIATE, ADVANCED, EXPERT.',
].join('\n');

/**
 * Extract structured {@link Extraction} data from readable document text.
 *
 * Builds a prompt instructing the model to return ONLY minified JSON matching
 * the extraction shape, invokes Bedrock, then parses and validates with
 * {@link extractionResponseSchema}. On a JSON or Zod failure it retries up to 2
 * times with a stricter reminder, then throws — letting the pipeline mark the
 * document Degraded (Req 4.5).
 */
export async function bedrockExtract(req: ExtractionRequest): Promise<Extraction> {
  const basePrompt = `${EXTRACTION_INSTRUCTIONS}\n\nDOCUMENT:\n${req.text}`;
  const maxAttempts = 3; // 1 initial + 2 retries
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const prompt =
      attempt === 1
        ? basePrompt
        : `${basePrompt}\n\nREMINDER: Your previous response was invalid. Respond with ONLY the minified JSON object described above and nothing else.`;

    try {
      const raw = await invoke(prompt, 2048);
      const parsed = extractionResponseSchema.parse(parseJsonObject(raw));
      return {
        topics: parsed.topics,
        concepts: parsed.concepts,
        claims: parsed.claims,
        difficulty: parsed.difficulty,
        summary: parsed.summary,
      };
    } catch (err) {
      lastError = err;
    }
  }

  throw new Error(
    `bedrockExtract failed after ${maxAttempts} attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`
  );
}

export interface ExplainInput {
  extraction: Extraction;
  scores: Scores;
  state: RecommendationState;
  profile: Profile;
  tags: RecommendationTag[];
}

/**
 * Produce a written explanation (50..1500 chars) covering (a) why the document
 * matters to this user, (b) what is genuinely new, and (c) why the assigned
 * recommendation state was chosen (Req 6.2). Returns the raw string; the worker
 * (task 6.4) applies the placeholder fallback when this fails or is too short
 * (Req 6.6).
 */
export async function bedrockExplain(input: ExplainInput): Promise<string> {
  const { extraction, scores, state, profile, tags } = input;

  const profileSummary = {
    highInterests: profile.highInterests,
    mediumInterests: profile.mediumInterests,
    currentlyResearching: profile.currentlyResearching,
    alreadyKnown: profile.alreadyKnown,
    context: profile.context,
  };

  const prompt = [
    'You explain a reading recommendation to a user in plain language.',
    'Write a single explanation between 50 and 1500 characters. No markdown, no headings, no JSON.',
    'It MUST cover all three of:',
    '(a) why this document matters to THIS user given their profile,',
    '(b) what is genuinely new to this user,',
    `(c) why the recommendation state "${state}" was chosen.`,
    tags.includes('REDUNDANT')
      ? "This document was judged redundant: state explicitly that no materially new content was detected relative to the user's prior knowledge."
      : '',
    '',
    `RECOMMENDATION_STATE: ${state}`,
    `TAGS: ${tags.join(', ') || 'none'}`,
    `SCORES: ${JSON.stringify(scores)}`,
    `USER_PROFILE: ${JSON.stringify(profileSummary)}`,
    `DOCUMENT_EXTRACTION: ${JSON.stringify({
      topics: extraction.topics,
      concepts: extraction.concepts,
      claims: extraction.claims,
      difficulty: extraction.difficulty,
      summary: extraction.summary,
    })}`,
  ]
    .filter(Boolean)
    .join('\n');

  return invoke(prompt, 1024);
}
