import { useQuery } from '@tanstack/react-query';
import type { KnowledgeSummary } from '@helious/core';
import { ArrowUpRight } from 'lucide-react';
import { api } from './api';
import { spaceQuery } from './knowledge';
import './insights.css';
interface Analytics extends KnowledgeSummary {
  activity: { date: string; count: number }[];
  activitySince: string | null;
  generatedAt: string;
  agentActivityAvailable: boolean;
  agentActivity?: {
    id: string;
    agent: string;
    tokenId: string;
    noteId: string;
    action: string;
    at: string;
  }[];
}
export function VaultAnalytics({
  vaultId,
  onOpen,
  spaceId = '',
}: {
  vaultId: string;
  onOpen: (id: string) => void;
  spaceId?: string;
}) {
  const query = useQuery({
    queryKey: ['analytics', vaultId, spaceId],
    queryFn: () =>
      api<Analytics>(`/vaults/${vaultId}/analytics${spaceId ? `?${spaceQuery(spaceId)}` : ''}`),
    refetchOnWindowFocus: false,
  });
  if (query.isPending)
    return (
      <div className="insights-loading" role="status">
        Reading your vault’s activity…
      </div>
    );
  if (query.error)
    return (
      <div className="insights-error" role="alert">
        <p>{query.error.message}</p>
        <button className="secondary-button" onClick={() => void query.refetch()}>
          Try again
        </button>
      </div>
    );
  const data = query.data;
  const counts = new Map(data.activity.map((day) => [day.date, day.count]));
  const end = new Date(data.generatedAt);
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 364);
  const pad = start.getUTCDay();
  const days = Array.from({ length: 365 }, (_unused, index) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + index);
    const key = date.toISOString().slice(0, 10);
    return { date: key, count: counts.get(key) ?? 0 };
  });
  const maxActivity = Math.max(1, ...data.activity.map((day) => day.count));
  const maxTag = Math.max(1, ...data.tags.map((tag) => tag.count));
  const dates = data.growth.map((point) => Date.parse(point.date));
  const minDate = Math.min(...dates);
  const dateSpan = Math.max(86400000, Math.max(...dates) - minDate);
  const path = data.growth
    .map(
      (point, i) =>
        `${i ? 'L' : 'M'}${20 + ((Date.parse(point.date) - minDate) / dateSpan) * 920},${175 - (point.total / Math.max(1, data.noteCount)) * 150}`,
    )
    .join(' ');
  return (
    <section className="vault-analytics" aria-label="Vault analytics">
      <header className="insights-heading">
        <div>
          <h2>A view of your thinking.</h2>
          <p>Notes, connections and the work that keeps them growing.</p>
        </div>
        <button className="secondary-button" onClick={() => void query.refetch()}>
          Refresh statistics
        </button>
      </header>
      <dl className="vault-metrics">
        {[
          ['Notes', data.noteCount],
          ['Words', data.words],
          ['Resolved links', data.links],
          ['Orphan notes', data.orphans],
          ['Unresolved links', data.unresolvedLinks],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{Number(value).toLocaleString()}</dd>
          </div>
        ))}
      </dl>
      <section className="activity-section">
        <div className="analytics-section-title">
          <h3>Activity</h3>
          <span>Last 365 days · UTC</span>
        </div>
        <p>
          Recorded note changes.{' '}
          {data.activitySince
            ? `Recording began ${data.activitySince.slice(0, 10)}.`
            : 'Your next note change will appear here.'}
        </p>
        <div className="activity-scroll">
          <svg
            className="activity-heatmap"
            role="img"
            aria-label={`${data.activity.reduce((sum, day) => sum + day.count, 0)} recorded note changes over the last 365 days`}
            viewBox="0 0 742 106"
          >
            {days.map((day, index) => (
              <rect
                key={day.date}
                x={Math.floor((index + pad) / 7) * 14}
                y={((index + pad) % 7) * 14}
                width={10}
                height={10}
                rx={2}
                className={
                  day.count
                    ? `activity-level-${Math.max(1, Math.ceil((day.count / maxActivity) * 4))}`
                    : 'activity-level-0'
                }
              >
                <title>
                  {day.date}: {day.count} changes
                </title>
              </rect>
            ))}
          </svg>
        </div>
        <div className="activity-legend">
          <span>Less</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <i key={level} className={`activity-level-${level}`} />
          ))}
          <span>More</span>
        </div>
        <details className="analytics-data">
          <summary>Activity data</summary>
          <p>
            Each created, saved, moved, rewritten or deleted note counts as one change. Activity
            starts with Phase 4; older edits are not reconstructed.
          </p>
          <table>
            <thead>
              <tr>
                <th>Date (UTC)</th>
                <th>Changes</th>
              </tr>
            </thead>
            <tbody>
              {data.activity.map((day) => (
                <tr key={day.date}>
                  <td>{day.date}</td>
                  <td>{day.count}</td>
                </tr>
              ))}
              {!data.activity.length && (
                <tr>
                  <td colSpan={2}>No recorded changes yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </details>
      </section>
      <div className="analytics-columns">
        <section>
          <div className="analytics-section-title">
            <h3>Growth</h3>
            <span>{data.noteCount.toLocaleString()} current notes</span>
          </div>
          <p>Current notes by their original creation date. Deleted notes are excluded.</p>
          {data.growth.length ? (
            <>
              <svg
                className="growth-chart"
                viewBox="0 0 960 200"
                role="img"
                aria-label={`Growth from ${data.growth[0]!.date} to ${data.growth.at(-1)!.date}, ending with ${data.noteCount} current notes`}
              >
                <path d="M20 175H940" className="chart-axis" />
                <path d={path} className="growth-line" />
                {data.growth.length === 1 && (
                  <circle cx="20" cy="25" r="4" className="growth-point" />
                )}
              </svg>
              <div className="growth-axis">
                <span>{data.growth[0]!.date}</span>
                <span>{data.growth.at(-1)!.date}</span>
              </div>
              <details className="analytics-data">
                <summary>Growth data</summary>
                <table>
                  <thead>
                    <tr>
                      <th>Created on</th>
                      <th>Notes added</th>
                      <th>Cumulative</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.growth.map((day) => (
                      <tr key={day.date}>
                        <td>{day.date}</td>
                        <td>{day.added}</td>
                        <td>{day.total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          ) : (
            <p className="analytics-empty">Your first note starts the story.</p>
          )}
        </section>
        <section>
          <div className="analytics-section-title">
            <h3>Tags</h3>
            <span>{data.tags.length} distinct</span>
          </div>
          {data.tags.length ? (
            <div className="tag-distribution">
              {data.tags.slice(0, 12).map((tag) => (
                <div key={tag.tag}>
                  <span>#{tag.tag}</span>
                  <span className="tag-bar">
                    <i style={{ width: `${(tag.count / maxTag) * 100}%` }} />
                  </span>
                  <strong>{tag.count}</strong>
                </div>
              ))}
            </div>
          ) : (
            <p className="analytics-empty">
              Add #tags or frontmatter tags to see their distribution.
            </p>
          )}
          {data.tags.length > 12 && (
            <details className="analytics-data">
              <summary>All tags</summary>
              <table>
                <thead>
                  <tr>
                    <th>Tag</th>
                    <th>Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tags.map((tag) => (
                    <tr key={tag.tag}>
                      <td>#{tag.tag}</td>
                      <td>{tag.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </section>
      </div>
      <section className="analytics-linked">
        <div className="analytics-section-title">
          <h3>Most linked notes</h3>
          <span>Distinct incoming notes</span>
        </div>
        <table>
          <thead>
            <tr>
              <th>Note</th>
              <th>Backlinks</th>
              <th>
                <span className="sr-only">Open</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.mostLinked.map((note) => (
              <tr key={note.id}>
                <td>{note.path}</td>
                <td>{note.incoming}</td>
                <td>
                  <button
                    aria-label={`Open ${note.path} from analytics`}
                    onClick={() => onOpen(note.id)}
                  >
                    <ArrowUpRight size={16} />
                  </button>
                </td>
              </tr>
            ))}
            {!data.mostLinked.length && (
              <tr>
                <td colSpan={3}>No notes yet.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
      <section className="agent-activity-notice">
        <h3>Agent activity</h3>
        <p>
          Recent agent reads and writes in this vault, filtered by Space. Activity is retained for
          90 days.
        </p>
        {data.agentActivity?.length ? (
          <div className="security-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Action</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {data.agentActivity.map((event) => (
                  <tr key={event.id}>
                    <td>{event.agent}</td>
                    <td>{event.action}</td>
                    <td>{new Date(event.at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>
            {data.agentActivityAvailable
              ? 'No agent activity in this view yet. Manage connections from Profile → AI connections.'
              : 'Agent activity is recorded by a connected server. Local folder changes appear in the activity chart above.'}
          </p>
        )}
      </section>
    </section>
  );
}
