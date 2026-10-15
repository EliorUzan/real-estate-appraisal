"""Pinned Claude Code capability profile for an individually owned account."""
PROFILE = 'claude-web-search-v1'
VERSION = '2.1.296'
POLICY = {
    'disableAllHooks': True,
    'disableClaudeAiConnectors': True,
    'permissions': {'allow': ['WebSearch'], 'deny': ['mcp__*', 'Bash', 'Read', 'Write', 'Edit', 'WebFetch', 'Agent']},
}
CHECKS = frozenset({'nativeAccountVerified', 'webSearchVerified', 'toolIsolationVerified', 'networkChecksPassed'})
MAPS_PROFILE = 'claude-web-search-maps-demo-v1'
MAPS_TOOLS = ('mcp__google_maps__search_places', 'mcp__google_maps__resolve_names')
MAPS_POLICY = {**POLICY, 'permissions': {
    'allow': ['WebSearch', *MAPS_TOOLS],
    'deny': ['Bash', 'Read', 'Write', 'Edit', 'WebFetch', 'Agent',
             'mcp__google_maps__compute_routes', 'mcp__google_maps__lookup_weather',
             'mcp__google_maps__resolve_maps_urls'],
}}
MAPS_CHECKS = CHECKS | {'mapsLookupVerified', 'mapsAttributionVerified'}
PROFILES = (PROFILE, MAPS_PROFILE)


def maps_config(key):
    from .maps_config import demo_key, MAPS_URL
    return {'mcpServers': {'google_maps': {'type': 'http', 'url': MAPS_URL,
            'headers': {'X-Goog-Api-Key': demo_key(key)}}}}


def arguments(profile=PROFILE):
    args = ['claude', '-p', '--output-format', 'json', '--tools', 'WebSearch',
        '--allowedTools', 'WebSearch', '--disallowedTools', 'mcp__*',
        '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
        '--permission-mode', 'dontAsk', '--setting-sources', '',
        '--settings', '/opt/gateway/claude-research-settings.json',
        '--disable-slash-commands', '--no-session-persistence', '--no-chrome', '--max-turns', '12']
    if profile == MAPS_PROFILE:
        args[args.index('--allowedTools') + 1] = ','.join(['WebSearch', *MAPS_TOOLS])
        args[args.index('--disallowedTools') + 1] = ','.join(MAPS_POLICY['permissions']['deny'])
        args[args.index('--mcp-config') + 1] = '/opt/gateway/claude-maps.json'
    elif profile != PROFILE:
        raise ValueError('Unknown Claude profile')
    return args


MODEL_EFFORT = {'claude-opus-5-5': 'high', 'claude-sonnet-5-5': 'medium', 'claude-haiku-5-5': 'low'}

def model_arguments(provider, selection):
    if selection == 'provider-default':
        return []
    if provider != 'claude' or not isinstance(selection, str) or selection not in MODEL_EFFORT:
        from .contracts import GatewayError
        raise GatewayError('UNSUPPORTED_CAPABILITY')
    return ['--model', selection, '--effort', MODEL_EFFORT[selection]]
