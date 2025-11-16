import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { XMLParser } from 'fast-xml-parser';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';
import type { MindMapPayload, MindMapNode, MindMapEdge, Citation } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 120;

type AiMindMapNode = {
  id: string;
  title: string;
  summary: string;
  parentIds?: string[];
  importance?: number;
  tags?: string[];
};

type AiMindMapEdge = {
  source: string;
  target: string;
  label?: string;
};

type MedlineContent = {
  ['@_name']?: string;
  ['#text']?: string;
  link?: { ['@_url']?: string } | Array<{ ['@_url']?: string }>;
};

type MedlineDocument = {
  name?: string;
  content?: MedlineContent | MedlineContent[];
};

type MedlineResponse = {
  nlmSearchResult?: {
    list?: {
      document?: MedlineDocument | MedlineDocument[];
    };
  };
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

async function fetchMedlineCitations(query: string): Promise<Citation[]> {
  const url = `https://wsearch.nlm.nih.gov/ws/query?db=healthTopics&term=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'agentic-3431c676/1.0 (mindmap medical verifier)',
      Accept: 'application/xml',
    },
    next: { revalidate: 60 * 60 },
  });

  if (!response.ok) {
    return [];
  }

  const xml = await response.text();
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    textNodeName: '#text',
  });
  const parsed = parser.parse(xml) as MedlineResponse;
  const documents = parsed.nlmSearchResult?.list?.document;

  if (!documents) {
    return [];
  }

  const docs = Array.isArray(documents) ? documents : [documents];

  return docs.slice(0, 3).map((doc) => {
    const contentRaw = doc.content;
    const contentArray: MedlineContent[] = Array.isArray(contentRaw) ? contentRaw : contentRaw ? [contentRaw] : [];
    const urlEdge = contentArray.find((c) => c?.['@_name'] === 'FullSummary');
    const snippetEdge = contentArray.find((c) => c?.['@_name'] === 'Snippet');
    const linkRaw = urlEdge?.link;
    let linkUrl = '';

    if (Array.isArray(linkRaw)) {
      linkUrl = linkRaw[0]?.['@_url'] ?? '';
    } else if (typeof linkRaw === 'object') {
      linkUrl = linkRaw?.['@_url'] ?? '';
    }

    return {
      title: doc?.name ?? query,
      url: linkUrl || `https://medlineplus.gov/${encodeURIComponent(query.toLowerCase())}.html`,
      snippet: snippetEdge?.['#text'] ?? undefined,
      source: 'MedlinePlus',
    };
  });
}

async function fetchWikipediaFallback(query: string): Promise<Citation[]> {
  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'agentic-3431c676/1.0 (mindmap medical verifier)',
      Accept: 'application/json',
    },
    next: { revalidate: 60 * 60 },
  });

  if (!response.ok) {
    return [];
  }

  const data = await response.json();

  if (!data?.content_urls?.desktop?.page) {
    return [];
  }

  return [
    {
      title: data.title ?? query,
      url: data.content_urls.desktop.page,
      snippet: data.extract ?? undefined,
      source: 'Wikipedia',
    },
  ];
}

async function verifyNode(query: string): Promise<Citation[]> {
  const medline = await fetchMedlineCitations(query);
  if (medline.length > 0) {
    return medline;
  }
  return fetchWikipediaFallback(query);
}

async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const uintArray = new Uint8Array(buffer);
  const pdf = await pdfjsLib.getDocument({ data: uintArray }).promise;
  let text = '';

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const pageText = content.items
        .map((item) => {
          if (typeof item === 'string') return item;
          const textItem = item as TextItem;
          return textItem.str ?? '';
        })
        .join(' ');
      text += `${pageText}\n`;
    }
  } finally {
    await pdf.destroy();
  }

  return text.trim();
}

async function buildMindMapFromText(text: string, openai: OpenAI): Promise<{
  nodes: MindMapNode[];
  edges: MindMapEdge[];
  sourceSummary: string;
}> {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('Missing OPENAI_API_KEY');
  }

  const systemPrompt = `You transform sets of medical study notes into structured mind map graphs.
Return STRICT JSON that matches this TypeScript type:
{
  "sourceSummary": string,
  "nodes": Array<{
    "id": string,
    "title": string,
    "summary": string,
    "parentIds": string[],
    "importance": 1 | 2 | 3 | 4 | 5,
    "tags": string[]
  }>,
  "edges": Array<{
    "source": string,
    "target": string,
    "label"?: string
  }>
}
Rules:
- Use concise but clinically accurate language.
- Parent-child relationships should reflect conceptual hierarchy or causality.
- Include at least one root node (with empty parentIds).
- Ensure IDs are unique slugs.
- Use parentIds to describe connections; you may also add optional edge labels for clarity.`;

  const userPrompt = `SOURCE NOTES:
"""
${text}
"""

1. Produce a clinically accurate mind map covering the major concepts, pathophysiology, diagnostics, and management strategies present in these notes.
2. Summaries should be short (<= 35 words) but precise.
3. Use importance 5 for critical core ideas and 1 for peripheral details.
4. Include meaningful tags such as "symptom", "diagnostic", "treatment", "risk-factor".`;

  const prompt = `${systemPrompt}\n\n${userPrompt}`;

  const response = await openai.responses.create({
    model: 'gpt-4o-mini',
    reasoning: { effort: 'medium' },
    temperature: 0.2,
    input: prompt,
    metadata: {
      application: 'agentic-3431c676',
      feature: 'mind-map-generation',
    },
  });

  const collectResponseText = (payload: AiResponseLike): string => {
    if (payload.output_text) {
      return payload.output_text;
    }
    if (payload.output && payload.output.length > 0) {
      const segments = payload.output.flatMap((item) =>
        (item.content ?? [])
          .map((content) => content?.text)
          .filter((segment): segment is string => typeof segment === 'string'),
      );
      if (segments.length > 0) {
        return segments.join('\n');
      }
    }
    return '';
  };

  const outputText = collectResponseText(response as AiResponseLike);
  if (!outputText) {
    throw new Error('Empty AI response');
  }

  const parsed = safeParseJson<{
    sourceSummary: string;
    nodes: AiMindMapNode[];
    edges: AiMindMapEdge[];
  }>(outputText);

  const nodes: MindMapNode[] = parsed.nodes.map((node) => ({
    id: node.id,
    title: node.title,
    summary: node.summary,
    parentIds: node.parentIds ?? [],
    importance: Math.min(5, Math.max(1, node.importance ?? 3)),
    tags: node.tags ?? [],
    citations: [],
    verified: false,
  }));

  const edges: MindMapEdge[] = parsed.edges.map((edge, index) => ({
    id: edge?.label ? `${edge.source}-${edge.target}-${edge.label}` : `edge-${index}`,
    source: edge.source,
    target: edge.target,
    label: edge.label,
  }));

  return {
    nodes,
    edges,
    sourceSummary: parsed.sourceSummary,
  };
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'A PDF file is required.' }, { status: 400 });
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const extractedText = await extractTextFromPdf(buffer);

    if (!extractedText) {
      return NextResponse.json({ error: 'Unable to extract text from PDF.' }, { status: 422 });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const mindMap = await buildMindMapFromText(extractedText, openai);

    const verifiedNodes: MindMapNode[] = [];

    for (const node of mindMap.nodes) {
      const citations = await verifyNode(node.title);
      const uniqueCitations = citations.filter(
        (citation, index, arr) => arr.findIndex((c) => c.url === citation.url) === index,
      );

      verifiedNodes.push({
        ...node,
        citations: uniqueCitations,
        verified: uniqueCitations.length > 0,
      });
    }

    const payload: MindMapPayload = {
      nodes: verifiedNodes,
      edges: mindMap.edges,
      generatedAt: new Date().toISOString(),
      sourceSummary: mindMap.sourceSummary,
    };

    return NextResponse.json(payload);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error processing PDF.',
      },
      { status: 500 },
    );
  }
}
