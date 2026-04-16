// Mock MCP server for testing mcprobe itself
// Implements a minimal MCP server over stdio transport

const readline = require('readline');

const tools = [
  {
    name: 'echo',
    description: 'Echo back the input message',
    inputSchema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Message to echo' },
      },
      required: ['message'],
    },
  },
  {
    name: 'add',
    description: 'Add two numbers',
    inputSchema: {
      type: 'object',
      properties: {
        a: { type: 'number', description: 'First number' },
        b: { type: 'number', description: 'Second number' },
      },
      required: ['a', 'b'],
    },
  },
  {
    name: 'search',
    description: 'Search the knowledge base',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results' },
      },
      required: ['query'],
    },
  },
];

const resources = [
  { uri: 'file:///docs/readme.md', name: 'README', mimeType: 'text/markdown' },
  { uri: 'file:///docs/api.md', name: 'API Docs', mimeType: 'text/markdown' },
];

const prompts = [
  {
    name: 'summarize',
    description: 'Summarize a document',
    arguments: [
      { name: 'document', description: 'Document text to summarize', required: true },
    ],
  },
];

function handleRequest(msg) {
  const { id, method, params } = msg;

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {}, resources: {}, prompts: {} },
          serverInfo: { name: 'mock-mcp-server', version: '0.1.0' },
        },
      };

    case 'notifications/initialized':
      return null; // no response for notifications

    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools } };

    case 'tools/call': {
      const tool = tools.find((t) => t.name === params.name);
      if (!tool) {
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown tool: ${params.name}` } };
      }
      let content;
      switch (params.name) {
        case 'echo':
          content = [{ type: 'text', text: params.arguments.message }];
          break;
        case 'add':
          content = [{ type: 'text', text: String(params.arguments.a + params.arguments.b) }];
          break;
        case 'search':
          content = [{ type: 'text', text: `Results for "${params.arguments.query}": item1, item2, item3` }];
          break;
        default:
          content = [{ type: 'text', text: 'ok' }];
      }
      return { jsonrpc: '2.0', id, result: { content } };
    }

    case 'resources/list':
      return { jsonrpc: '2.0', id, result: { resources } };

    case 'resources/read': {
      const res = resources.find((r) => r.uri === params.uri);
      if (!res) {
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown resource: ${params.uri}` } };
      }
      return {
        jsonrpc: '2.0',
        id,
        result: {
          contents: [{ uri: params.uri, mimeType: res.mimeType, text: `# ${res.name}\n\nSample content for ${res.name}.` }],
        },
      };
    }

    case 'prompts/list':
      return { jsonrpc: '2.0', id, result: { prompts } };

    case 'prompts/get': {
      const prompt = prompts.find((p) => p.name === params.name);
      if (!prompt) {
        return { jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown prompt: ${params.name}` } };
      }
      return {
        jsonrpc: '2.0',
        id,
        result: {
          description: prompt.description,
          messages: [
            { role: 'user', content: { type: 'text', text: `Please summarize the following:\n\n${params.arguments?.document || '(no document provided)'}` } },
          ],
        },
      };
    }

    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
  }
}

const rl = readline.createInterface({ input: process.stdin });

rl.on('line', (line) => {
  if (!line.trim()) return;
  try {
    const msg = JSON.parse(line);
    const response = handleRequest(msg);
    if (response) {
      process.stdout.write(JSON.stringify(response) + '\n');
    }
  } catch {
    // ignore
  }
});
