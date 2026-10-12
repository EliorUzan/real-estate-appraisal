"""Exact read-only native capability profile for the personal Google runtime."""
PROFILE = 'web-search-v1'
WEB_TOOLS = frozenset({'search_web'})
AGENT_NAME = 'cli-gateway-research'
AGENT = b'''---
name: cli-gateway-research
description: Research the user's request using read-only web tools.
tools: [search_web]
excludeDefaultComponents: true
mainAgent: true
subagent: false
commandExecutionPolicy: off
mcpServers: []
skills: []
plugins: []
---
Follow the supplied task instructions. Web search is available.
'''
POLICY = {'toolPermission':'strict','allowNonWorkspaceAccess':False,'enableTelemetry':False,
    'useG1Credits':False,'permissions':{'allow':[],'ask':[],
    'deny':['read_file(*)','write_file(*)','execute_url(*)','command(*)','unsandboxed(*)','mcp(*)']},'hooks':{}}
CHECKS = frozenset({'nativeAccountVerified','webSearchVerified',
    'nativeReadDenied','networkChecksPassed','agentSelected'})
