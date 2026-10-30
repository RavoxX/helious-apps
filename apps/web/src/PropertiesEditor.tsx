import { useId, useMemo, useState } from 'react';
import { parseMarkdown, replaceProperties, dailyNotePath, type PropertyValue } from '@helious/core';

type Kind = 'text' | 'number' | 'boolean' | 'date' | 'list' | 'json' | 'null';
export function PropertiesEditor({
  value,
  change,
}: {
  value: string;
  change: (value: string) => void;
}) {
  const id = useId();
  const parsed = useMemo(() => {
    try {
      return parseMarkdown(value);
    } catch (cause) {
      return {
        properties: {} as Record<string, PropertyValue>,
        warnings: [cause instanceof Error ? cause.message : 'Cannot parse this note.'],
      };
    }
  }, [value]);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Kind>('text');
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  function apply(remove = false, key = name.trim()) {
    try {
      const properties = { ...parsed.properties };
      if (remove) delete properties[key];
      else {
        if (!key) throw new Error('Enter a property name.');
        let next: PropertyValue = input;
        if (kind === 'number') {
          if (!input.trim() || !Number.isFinite(Number(input)))
            throw new Error('Enter a finite number.');
          next = Number(input);
        } else if (kind === 'boolean') next = input === 'true';
        else if (kind === 'date') dailyNotePath(input);
        else if (kind === 'list') next = input ? input.split('\n') : [];
        else if (kind === 'null') next = null;
        else if (kind === 'json') next = JSON.parse(input) as PropertyValue;
        Object.defineProperty(properties, key, {
          value: next,
          enumerable: true,
          configurable: true,
          writable: true,
        });
      }
      change(replaceProperties(value, properties));
      setError('');
      setName('');
      setInput('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Check the property value.');
    }
  }
  function edit(key: string, property: PropertyValue) {
    setName(key);
    setError('');
    if (property === null) {
      setKind('null');
      setInput('');
    } else if (typeof property === 'object') {
      setKind('json');
      setInput(JSON.stringify(property, null, 2));
    } else {
      setKind(
        typeof property === 'number'
          ? 'number'
          : typeof property === 'boolean'
            ? 'boolean'
            : 'text',
      );
      setInput(String(property));
    }
  }
  return (
    <details className="properties-editor">
      <summary>
        Properties <span>({Object.keys(parsed.properties).length})</span>
      </summary>
      {parsed.warnings.length > 0 && (
        <p>Check frontmatter in Source mode before editing properties.</p>
      )}
      <dl>
        {Object.entries(parsed.properties).map(([key, property]) => (
          <div key={key}>
            <dt>{key}</dt>
            <dd>
              <code>{typeof property === 'string' ? property : JSON.stringify(property)}</code>
              <button
                type="button"
                aria-label={`Edit property ${key}`}
                onClick={() => edit(key, property)}
              >
                Edit
              </button>
              <button
                type="button"
                aria-label={`Remove property ${key}`}
                onClick={() => apply(true, key)}
              >
                Remove
              </button>
            </dd>
          </div>
        ))}
      </dl>
      <div className="property-controls">
        <label htmlFor={`${id}-name`}>Property name</label>
        <input
          id={`${id}-name`}
          value={name}
          maxLength={100}
          onChange={(event) => setName(event.target.value)}
        />
        <label htmlFor={`${id}-type`}>Property type</label>
        <select
          id={`${id}-type`}
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as Kind);
            setInput('');
          }}
        >
          {(['text', 'number', 'boolean', 'date', 'list', 'json', 'null'] as const).map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
        <label htmlFor={`${id}-value`}>
          Property value{kind === 'list' ? ' (one item per line)' : ''}
        </label>
        {kind === 'boolean' ? (
          <select
            id={`${id}-value`}
            value={input || 'false'}
            onChange={(event) => setInput(event.target.value)}
          >
            <option value="false">false</option>
            <option value="true">true</option>
          </select>
        ) : (
          <textarea
            id={`${id}-value`}
            value={input}
            disabled={kind === 'null'}
            rows={kind === 'json' || kind === 'list' ? 4 : 1}
            onChange={(event) => setInput(event.target.value)}
          />
        )}
        <button type="button" disabled={!name.trim()} onClick={() => apply()}>
          Apply property
        </button>
      </div>
      <p>
        Property changes are part of your unsaved note. Save the note to keep them. Use Source mode
        for anchors or advanced YAML.
      </p>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
    </details>
  );
}
