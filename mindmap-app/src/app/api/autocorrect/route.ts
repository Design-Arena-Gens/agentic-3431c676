import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import type { MindMapNode } from '@/lib/types';

export const runtime = 'nodejs';

type AutoCorrectRequest = {
  node: MindMapNode;
};

type AiResponseLike = {
  output_text?: string | null;
  output?: Array<{
    content?: Array<{
      text?: string;
    }>;
  }>;
};

function safeParseJson<T>(input: string): T {
  try {
    return JSON.parse(input) as T;
  } catch {
    const start = input.indexOf('{');
    const end = input.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      return JSON.parse(input.slice(start, end + 1)) as T;
    }
    throw new Error('Failed to parse JSON from AI response');
  }
}

const collectResponseText = (payload: AiResponseLike): string => {
  if (payload.output_text) {
    return payload.output_text;
  }
  if (payload.output && payload.output.length > 0) {
    const segments = payload.output.flatMap((item) =>
      (item.content ?? []).map((content) => content?.text).filter((segment): segment is string => typeof segment === 'string'),
    );
    if (segments.length > 0) {
      return segments.join('\n');
    }
  }
  return '';
};

export async function POST(request: Request) {
  try {
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'Missing OPENAI_API_KEY' }, { status: 500 });
    }

    const payload = (await request.json()) as AutoCorrectRequest;

    if (!payload?.node) {
      return NextResponse.json({ error: 'Node payload missing.' }, { status: 400 });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const citationsText =
      payload.node.citations.length > 0
        ? payload.node.citations
            .map(
              (citation, index) =>
                `${index + 1}. ${citation.title}\nSource: ${citation.source}\nURL: ${citation.url}\nSnippet: ${
                  citation.snippet ?? 'N/A'
                }`,
            )
            .join('\n\n')
        : 'No citations available.';

    const prompt = `You are an expert medical editor. Update the provided mind map node summary so it is factually aligned with the citations. Keep the summary <= 35 words, clinically precise, and suitable for a study mind map.

Current Node:
Title: ${payload.node.title}
Summary: ${payload.node.summary}

Citations:
${citationsText}

Respond with JSON:
{
  "summary": string,
  "tags": string[]
}`;

    const response = await openai.responses.create({
      model: 'gpt-4o-mini',
      temperature: 0.1,
      input: prompt,
    });

    const outputText = collectResponseText(response as AiResponseLike);
    if (!outputText) {
      throw new Error('Empty AI response');
    }

    const parsed = safeParseJson<{ summary: string; tags?: string[] }>(outputText);

    return NextResponse.json({
      summary: parsed.summary ?? payload.node.summary,
      tags: parsed.tags ?? payload.node.tags,
    });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to auto-correct node.',
      },
      { status: 500 },
    );
  }
}
