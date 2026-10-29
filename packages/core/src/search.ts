export interface SearchQuery {
  terms: string[];
  tags: string[];
  paths: string[];
  files: string[];
  excludedTags: string[];
}
/** Phase 2 supports literal words/phrases and tag:, path:, file:, -tag: filters. */
export function parseSearchQuery(value: string): SearchQuery {
  if (value.length > 256) throw new Error('Search queries are limited to 256 characters');
  const result: SearchQuery = { terms: [], tags: [], paths: [], files: [], excludedTags: [] };
  const tokens = value.match(/(?:-?[a-z]+:)?"[^"]*"|\S+/gi) ?? [];
  if (tokens.length > 16) throw new Error('Use at most 16 search terms');
  for (const token of tokens) {
    const match = /^(-?)([a-z]+):(.*)$/i.exec(token);
    const unquote = (text: string) => text.replace(/^"|"$/g, '');
    if (!match) {
      if (/^\/.*\/[a-z]*$/i.test(token))
        throw new Error('Regular-expression search is not available yet');
      const term = unquote(token);
      if (term) result.terms.push(term);
      continue;
    }
    const negative = match[1] === '-';
    const operator = match[2]!.toLowerCase();
    const term = unquote(match[3]!);
    if (!term) throw new Error('Search filters need a value');
    if (operator === 'tag')
      (negative ? result.excludedTags : result.tags).push(term.replace(/^#/, '').toLowerCase());
    else if (operator === 'path' && !negative) result.paths.push(term);
    else if (operator === 'file' && !negative) result.files.push(term);
    else throw new Error(`Unsupported search filter: ${match[1]}${operator}`);
  }
  return result;
}
export const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
