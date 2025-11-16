'use client';

import { memo, useMemo } from 'react';
import type { NodeProps } from 'reactflow';
import { Handle, Position } from 'reactflow';
import { CheckCircle2, AlertTriangle, RefreshCcw } from 'lucide-react';
import type { Citation } from '@/lib/types';

export type MindMapNodeData = {
  title: string;
  summary: string;
  importance: number;
  tags: string[];
  citations: Citation[];
  verified: boolean;
  autoCorrected?: boolean;
};

const importanceBorders: Record<number, string> = {
  1: '#d4d4d8',
  2: '#93c5fd',
  3: '#3b82f6',
  4: '#6366f1',
  5: '#4338ca',
};

const CustomNode = memo<NodeProps<MindMapNodeData>>(({ data }) => {
  const borderColor = importanceBorders[data.importance] ?? '#d4d4d8';
  const badgeStyle = useMemo(() => {
    if (data.importance >= 5) return { background: '#4338ca', color: '#ffffff' };
    if (data.importance >= 4) return { background: '#4f46e5', color: '#ffffff' };
    if (data.importance === 3) return { background: '#2563eb', color: '#ffffff' };
    if (data.importance === 2) return { background: '#38bdf8', color: '#0f172a' };
    return { background: '#e2e8f0', color: '#1e293b' };
  }, [data.importance]);

  return (
    <div
      style={{
        minWidth: 220,
        maxWidth: 260,
        borderRadius: 12,
        border: `2px solid ${borderColor}`,
        background: '#ffffff',
        padding: 12,
        boxShadow: '0 8px 14px rgba(15, 23, 42, 0.12)',
      }}
    >
      <Handle type="target" position={Position.Left} style={{ width: 8, height: 8, background: '#4f46e5' }} />
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>{data.title}</h3>
          <p style={{ marginTop: 4, fontSize: 12, color: '#475569', lineHeight: 1.4 }}>{data.summary}</p>
        </div>
        <span
          style={{
            ...badgeStyle,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '999px',
            width: 24,
            height: 24,
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          {data.importance}
        </span>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        {data.tags.slice(0, 4).map((tag) => (
          <span
            key={tag}
            style={{
              borderRadius: 999,
              background: '#f1f5f9',
              color: '#475569',
              padding: '3px 8px',
              fontSize: 10,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
            }}
          >
            {tag}
          </span>
        ))}
        {data.autoCorrected ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              borderRadius: 999,
              background: '#d1fae5',
              color: '#047857',
              padding: '3px 8px',
              fontSize: 10,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
            }}
          >
            <RefreshCcw size={10} strokeWidth={2} /> Corrected
          </span>
        ) : null}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, marginTop: 10 }}>
        {data.verified ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#047857' }}>
            <CheckCircle2 size={14} /> Verified ({data.citations.length})
          </span>
        ) : (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#d97706' }}>
            <AlertTriangle size={14} /> Needs review
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Right} style={{ width: 8, height: 8, background: '#4f46e5' }} />
    </div>
  );
});

CustomNode.displayName = 'CustomNode';

export default CustomNode;
