"""Pinned Claude Code capability profile for an individually owned account."""
PROFILE = 'claude-web-search-v1'
VERSION = '2.1.296'
POLICY = {
    'disableAllHooks': True,
    'disableClaudeAiConnectors': True,
    'permissions': {'allow': ['WebSearch'], 'deny': ['mcp__*', 'Bash', 'Read', 'Write', 'Edit', 'WebFetch', 'Agent']},
}
CHECKS = frozenset({'nativeAccountVerified', 'webSearchVerified', 'toolIsolationVerified', 'networkChecksPassed'})


def arguments():
    return ['claude', '-p', '--output-format', 'json', '--tools', 'WebSearch',
        '--allowedTools', 'WebSearch', '--disallowedTools', 'mcp__*',
        '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
        '--permission-mode', 'dontAsk', '--setting-sources', '',
        '--settings', '/opt/gateway/claude-research-settings.json',
        '--disable-slash-commands', '--no-session-persistence', '--no-chrome', '--max-turns', '12']
