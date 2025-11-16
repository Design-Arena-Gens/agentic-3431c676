'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  ReactFlowInstance,
  addEdge,
  useEdgesState,
  useNodesState,
  Connection,
  Edge,
  Node,
} from 'reactflow';
import 'reactflow/dist/style.css';
import { toJpeg, toPng } from 'html-to-image';
import jsPDF from 'jspdf';
import { UploadCloud, RefreshCcw, Wand2, FileDown, FileText, ChevronRight, CheckCircle2, Link } from 'lucide-react';
import CustomNode, { MindMapNodeData } from './CustomNode';
import { getLayoutedElements } from '@/lib/layout';
import type { MindMapNode, MindMapEdge, MindMapPayload } from '@/lib/types';

type UploadState = 'idle' | 'uploading' | 'verifying';

const nodeTypes = { custom: CustomNode };

function convertNodes(nodes: MindMapNode[]): Node<MindMapNodeData>[] {
  return nodes.map((node) => ({
    id: node.id,
    type: 'custom',
    data: {
      title: node.title,
      summary: node.summary,
      importance: node.importance,
      tags: node.tags,
      citations: node.citations,
      verified: node.verified,
      autoCorrected: node.autoCorrected,
    },
    position: { x: 0, y: 0 },
  }));
}

function convertEdges(edges: MindMapEdge[]): Edge[] {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
    label: edge.label,
    type: 'smoothstep',
    animated: false,
  }));
}

async function readFileAsFormData(file: File) {
  const formData = new FormData();
  formData.append('file', file);
  return formData;
}

export default function MindMapApp() {
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [mindMap, setMindMap] = useState<MindMapPayload | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [reactFlowInstance, setReactFlowInstance] = useState<ReactFlowInstance | null>(null);

  const reactFlowWrapper = useRef<HTMLDivElement | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<MindMapNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const selectedNode = useMemo(() => {
    if (!mindMap || !selectedNodeId) return null;
    return mindMap.nodes.find((node) => node.id === selectedNodeId) ?? null;
  }, [mindMap, selectedNodeId]);

  useEffect(() => {
    if (mindMap) {
      const rfNodes = convertNodes(mindMap.nodes);
      const rfEdges = convertEdges(mindMap.edges);
      const layoutedNodes = getLayoutedElements(rfNodes, rfEdges);
      setNodes(layoutedNodes);
      setEdges(rfEdges);
    }
  }, [mindMap, setEdges, setNodes]);

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge({ ...connection, type: 'smoothstep', animated: false }, eds));
    },
    [setEdges],
  );

  const onNodeClick = useCallback((_event: MouseEvent, node: Node<MindMapNodeData>) => {
    setSelectedNodeId(node.id);
  }, []);

  const resetSelection = useCallback(() => {
    setSelectedNodeId(null);
  }, []);

  const handleUpload = useCallback(
    async (file: File) => {
      setUploadState('uploading');
      setError(null);
      try {
        const formData = await readFileAsFormData(file);
        const response = await fetch('/api/generate', {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          const payload = await response.json();
          throw new Error(payload?.error ?? 'Unable to process PDF.');
        }

        setUploadState('verifying');
        const payload = (await response.json()) as MindMapPayload;
        setMindMap(payload);
        setSelectedNodeId(payload.nodes[0]?.id ?? null);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to process upload.';
        setError(message);
      } finally {
        setUploadState('idle');
      }
    },
    [],
  );

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      const file = event.dataTransfer.files?.[0];
      if (file) {
        void handleUpload(file);
      }
    },
    [handleUpload],
  );

  const onFileInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        void handleUpload(file);
        event.target.value = '';
      }
    },
    [handleUpload],
  );

  const exportDiagram = useCallback(
    async (format: 'png' | 'jpeg' | 'pdf') => {
      if (!reactFlowWrapper.current) return;
      const node = reactFlowWrapper.current.querySelector('.react-flow__viewport') as HTMLElement | null;
      const target = node ?? reactFlowWrapper.current;

      if (format === 'pdf') {
        const dataUrl = await toPng(target, { cacheBust: true, backgroundColor: '#f8fafc', pixelRatio: 2 });
        const pdf = new jsPDF({
          orientation: 'landscape',
          unit: 'pt',
          format: [target.clientWidth * 1.2, target.clientHeight * 1.2],
        });
        const width = pdf.internal.pageSize.getWidth();
        const height = (target.clientHeight * width) / target.clientWidth;
        pdf.addImage(dataUrl, 'PNG', 20, 20, width - 40, height - 40);
        pdf.save('mind-map.pdf');
        return;
      }

      const dataUrl =
        format === 'png'
          ? await toPng(target, { cacheBust: true, backgroundColor: '#f8fafc', pixelRatio: 2 })
          : await toJpeg(target, { cacheBust: true, backgroundColor: '#f8fafc', pixelRatio: 2, quality: 0.95 });

      const link = document.createElement('a');
      link.download = format === 'png' ? 'mind-map.png' : 'mind-map.jpeg';
      link.href = dataUrl;
      link.click();
    },
    [],
  );

  const regenerateMindMap = useCallback(() => {
    setSelectedNodeId(null);
    setMindMap(null);
  }, []);

  const updateNode = useCallback(
    (updated: MindMapNode) => {
      setMindMap((prev) => {
        if (!prev) return prev;
        const nodes = prev.nodes.map((node) => (node.id === updated.id ? updated : node));
        return { ...prev, nodes };
      });
    },
    [],
  );

  const handleNodeFieldChange = useCallback(
    (field: 'title' | 'summary' | 'importance' | 'tags', value: string) => {
      if (!selectedNode) return;
      const nextNode: MindMapNode = {
        ...selectedNode,
        [field]:
          field === 'importance'
            ? Math.max(1, Math.min(5, Number(value)))
            : field === 'tags'
            ? value
                .split(',')
                .map((tag) => tag.trim())
                .filter(Boolean)
            : value,
      };
      updateNode(nextNode);
    },
    [selectedNode, updateNode],
  );

  const autoCorrectSelectedNode = useCallback(async () => {
    if (!selectedNode) return;
    try {
      const response = await fetch('/api/autocorrect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ node: selectedNode }),
      });
      if (!response.ok) {
        const payload = await response.json();
        throw new Error(payload?.error ?? 'Autocorrect failed.');
      }
      const payload = (await response.json()) as { summary: string; tags: string[] };
      updateNode({
        ...selectedNode,
        summary: payload.summary,
        tags: payload.tags,
        autoCorrected: true,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Autocorrect failed.';
      setError(message);
    }
  }, [selectedNode, updateNode]);

  const onInit = useCallback((instance: ReactFlowInstance) => {
    setReactFlowInstance(instance);
  }, []);

  useEffect(() => {
    if (reactFlowInstance) {
      reactFlowInstance.fitView({ padding: 0.2, duration: 800 });
    }
  }, [reactFlowInstance, nodes, edges]);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#f8fafc' }}>
      <header
        style={{
          padding: '18px 32px',
          borderBottom: '1px solid #e2e8f0',
          background: '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
        }}
      >
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1e293b' }}>MedMind Cartographer</h1>
          <p style={{ marginTop: 4, fontSize: 14, color: '#475569' }}>
            Transform medical notes into verified, editable mind maps with AI assistance.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            type="button"
            onClick={() => exportDiagram('png')}
            style={primaryGhostButtonStyle}
          >
            <FileDown size={16} />
            Export PNG
          </button>
          <button
            type="button"
            onClick={() => exportDiagram('jpeg')}
            style={primaryGhostButtonStyle}
          >
            <FileText size={16} />
            Export JPEG
          </button>
          <button
            type="button"
            onClick={() => exportDiagram('pdf')}
            style={primaryButtonStyle}
          >
            <FileDown size={16} />
            Export PDF
          </button>
        </div>
      </header>

      <main style={{ flex: 1, display: 'grid', gridTemplateColumns: '360px 1fr', minHeight: 0 }}>
        <section
          style={{
            borderRight: '1px solid #e2e8f0',
            background: '#ffffff',
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 24,
            overflowY: 'auto',
          }}
        >
          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={onDrop}
            style={{
              border: '2px dashed #cbd5f5',
              borderRadius: 16,
              padding: 24,
              textAlign: 'center',
              background: '#f8fbff',
            }}
          >
            <UploadCloud size={28} color="#4338ca" />
            <p style={{ marginTop: 12, fontWeight: 600, color: '#1e293b' }}>Upload study notes PDF</p>
            <p style={{ marginTop: 4, fontSize: 13, color: '#475569' }}>Drop a PDF or browse files</p>
            <label
              htmlFor="pdf-upload"
              style={{
                marginTop: 16,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 14px',
                borderRadius: 999,
                background: '#4338ca',
                color: '#ffffff',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Choose file
              <input id="pdf-upload" type="file" accept="application/pdf" onChange={onFileInputChange} style={{ display: 'none' }} />
            </label>
            {uploadState !== 'idle' ? (
              <p style={{ marginTop: 12, fontSize: 13, color: '#4338ca' }}>
                {uploadState === 'uploading' ? 'Processing PDF…' : 'Cross-checking medical references…'}
              </p>
            ) : null}
          </div>

          {mindMap ? (
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1e293b' }}>Source summary</h2>
                <button type="button" onClick={regenerateMindMap} style={secondaryButtonStyle}>
                  <RefreshCcw size={14} />
                  Regenerate
                </button>
              </div>
              <p style={{ marginTop: 8, fontSize: 13, color: '#475569', lineHeight: 1.5 }}>{mindMap.sourceSummary}</p>
            </div>
          ) : null}

          {selectedNode ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <h2 style={{ fontSize: 16, fontWeight: 700, color: '#1e293b' }}>Node editor</h2>
                <button type="button" onClick={resetSelection} style={{ border: 'none', background: 'transparent', color: '#64748b' }}>
                  Clear
                </button>
              </div>
              <label style={labelStyle}>
                Title
                <input
                  value={selectedNode.title}
                  onChange={(event) => handleNodeFieldChange('title', event.target.value)}
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                Summary
                <textarea
                  value={selectedNode.summary}
                  onChange={(event) => handleNodeFieldChange('summary', event.target.value)}
                  rows={4}
                  style={{ ...inputStyle, resize: 'vertical' }}
                />
              </label>
              <label style={labelStyle}>
                Importance (1-5)
                <input
                  type="number"
                  min={1}
                  max={5}
                  value={selectedNode.importance}
                  onChange={(event) => handleNodeFieldChange('importance', event.target.value)}
                  style={inputStyle}
                />
              </label>
              <label style={labelStyle}>
                Tags (comma separated)
                <input
                  value={selectedNode.tags.join(', ')}
                  onChange={(event) => handleNodeFieldChange('tags', event.target.value)}
                  style={inputStyle}
                />
              </label>

              <button type="button" onClick={autoCorrectSelectedNode} style={primaryButtonStyle}>
                <Wand2 size={16} />
                Auto-correct with citations
              </button>

              <div>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: '#334155', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <CheckCircle2 size={16} color={selectedNode.verified ? '#047857' : '#d97706'} />
                  {selectedNode.verified ? 'Citations' : 'No verifiable sources found'}
                </h3>
                <ul style={{ marginTop: 8, listStyle: 'none', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {selectedNode.citations.map((citation) => (
                    <li
                      key={citation.url}
                      style={{
                        border: '1px solid #e2e8f0',
                        borderRadius: 12,
                        padding: 12,
                        background: '#f8fafc',
                      }}
                    >
                      <p style={{ fontSize: 13, fontWeight: 600, color: '#1e293b' }}>{citation.title}</p>
                      {citation.snippet ? (
                        <p style={{ marginTop: 6, fontSize: 12, color: '#475569', lineHeight: 1.4 }}>{citation.snippet}</p>
                      ) : null}
                      <a
                        href={citation.url}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          marginTop: 8,
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: 12,
                          color: '#4338ca',
                        }}
                      >
                        <Link size={14} /> {citation.source}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          {error ? (
            <div
              style={{
                borderRadius: 12,
                border: '1px solid #fecdd3',
                background: '#fff1f2',
                padding: 16,
                color: '#be123c',
                fontSize: 13,
              }}
            >
              {error}
            </div>
          ) : null}
        </section>

        <section style={{ position: 'relative', minHeight: 0 }}>
          <div ref={reactFlowWrapper} style={{ position: 'absolute', inset: 0 }}>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              onNodeClick={onNodeClick}
              fitView
              nodeTypes={nodeTypes}
              defaultEdgeOptions={{ type: 'smoothstep' }}
              onInit={onInit}
            >
              <Background gap={18} color="#cbd5f5" />
              <MiniMap
                nodeColor={(node) => {
                  const data = node.data as MindMapNodeData;
                  if (data.importance >= 5) return '#4338ca';
                  if (data.importance >= 4) return '#6366f1';
                  if (data.importance === 3) return '#3b82f6';
                  return '#94a3b8';
                }}
              />
              <Controls />
            </ReactFlow>
          </div>
          {!mindMap ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 16,
                color: '#475569',
              }}
            >
              <div
                style={{
                  borderRadius: 20,
                  border: '1px solid #cbd5f5',
                  padding: '32px 36px',
                  background: 'rgba(255,255,255,0.82)',
                  textAlign: 'center',
                  maxWidth: 420,
                  boxShadow: '0 24px 40px rgba(15,23,42,0.12)',
                }}
              >
                <h2 style={{ fontSize: 20, fontWeight: 700, color: '#1e293b' }}>Awaiting your notes</h2>
                <p style={{ marginTop: 10, fontSize: 14, lineHeight: 1.5 }}>
                  Upload a PDF of your medical study notes to generate an interactive, reference-backed mind map.
                </p>
                <div style={{ marginTop: 16, display: 'inline-flex', alignItems: 'center', gap: 8, color: '#4338ca', fontWeight: 600 }}>
                  <ChevronRight size={16} />
                  Start by uploading
                </div>
              </div>
            </div>
          ) : null}
        </section>
      </main>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  fontSize: 13,
  color: '#0f172a',
};

const inputStyle: React.CSSProperties = {
  borderRadius: 10,
  border: '1px solid #cbd5f5',
  padding: '10px 12px',
  fontSize: 13,
  color: '#0f172a',
  background: '#ffffff',
};

const baseButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 16px',
  borderRadius: 12,
  cursor: 'pointer',
  border: 'none',
  fontSize: 13,
  fontWeight: 600,
  transition: 'background 0.2s ease',
};

const primaryButtonStyle: React.CSSProperties = {
  ...baseButtonStyle,
  background: '#4338ca',
  color: '#ffffff',
};

const primaryGhostButtonStyle: React.CSSProperties = {
  ...baseButtonStyle,
  background: '#eef2ff',
  color: '#312e81',
};

const secondaryButtonStyle: React.CSSProperties = {
  ...baseButtonStyle,
  background: '#e2e8f0',
  color: '#1e293b',
};
