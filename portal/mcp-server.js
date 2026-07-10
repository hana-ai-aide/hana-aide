const fs = require('fs');
const path = require('path');

const WORKSPACE_ROOT = path.resolve(process.env.HARNESS_PROJECT_ROOT || process.env.HARNESS_HOME || path.join(__dirname, '..'));
const SEARCH_PATHS = [
  path.join(WORKSPACE_ROOT, 'specs'),
  path.join(WORKSPACE_ROOT, 'governance'),
  path.join(WORKSPACE_ROOT, 'legislation'),
  path.join(WORKSPACE_ROOT, '.worktable')
];

// Helper to check if file is markdown
function isMarkdown(file) {
  return file.endsWith('.md') || file.endsWith('.markdown');
}

// Recursively find markdown files in target directories
function getMarkdownFiles(dir) {
  let results = [];
  if (!fs.existsSync(dir)) return results;

  const list = fs.readdirSync(dir);
  for (const file of list) {
    // Skip hidden files/directories and build folders
    if (file.startsWith('.')) continue;
    const skipDirs = ['node_modules', '.next', 'publish', 'app_data', 'dist', 'build', 'out'];
    if (skipDirs.includes(file)) continue;

    const fullPath = path.join(dir, file);
    let stat;
    try {
      stat = fs.statSync(fullPath);
    } catch (e) {
      continue;
    }

    if (stat && stat.isDirectory()) {
      results = results.concat(getMarkdownFiles(fullPath));
    } else if (isMarkdown(file)) {
      results.push(fullPath);
    }
  }
  return results;
}

// Perform keyword search inside all markdown files
function searchSpecs(query, wsRoot = WORKSPACE_ROOT) {
  const normalizedQuery = query.toLowerCase();
  const allFiles = [];
  const searchPaths = [
    path.join(wsRoot, 'specs'),
    path.join(wsRoot, 'governance'),
    path.join(wsRoot, 'legislation'),
    path.join(wsRoot, '.worktable')
  ];
  
  for (const dir of searchPaths) {
    if (fs.existsSync(dir)) {
      allFiles.push(...getMarkdownFiles(dir));
    }
  }

  const results = [];
  for (const filePath of allFiles) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const relPath = path.relative(wsRoot, filePath).replace(/\\/g, '/');
      const lines = content.split(/\r?\n/);
      
      const matchedLines = [];
      lines.forEach((line, index) => {
        if (line.toLowerCase().includes(normalizedQuery)) {
          // Store line number (1-indexed) and content snippet
          matchedLines.push({
            line: index + 1,
            text: line.trim()
          });
        }
      });

      if (matchedLines.length > 0) {
        results.push({
          filePath: relPath,
          matches: matchedLines.slice(0, 15) // Limit to top 15 matches per file
        });
      }
    } catch (err) {
      // Ignore read errors
    }
  }
  return results;
}

// Read complete content of a specific file
function readSpecFile(relPath, wsRoot = WORKSPACE_ROOT) {
  const fullPath = path.resolve(wsRoot, relPath);
  const searchPaths = [
    path.join(wsRoot, 'specs'),
    path.join(wsRoot, 'governance'),
    path.join(wsRoot, 'legislation'),
    path.join(wsRoot, '.worktable')
  ];
  
  // Safety check: must remain inside workspace and belong to allowed directories
  if (!fullPath.startsWith(wsRoot)) {
    throw new Error('Access denied: File out of bounds');
  }
  
  const isAllowedPath = searchPaths.some(allowedDir => fullPath.startsWith(allowedDir));
  if (!isAllowedPath) {
    throw new Error('Access denied: Directory not allowed for reading');
  }

  if (!fs.existsSync(fullPath)) {
    throw new Error(`File not found: ${relPath}`);
  }

  return fs.readFileSync(fullPath, 'utf8');
}

// List all specification files
function listSpecs(wsRoot = WORKSPACE_ROOT) {
  const allFiles = [];
  const searchPaths = [
    path.join(wsRoot, 'specs'),
    path.join(wsRoot, 'governance'),
    path.join(wsRoot, 'legislation'),
    path.join(wsRoot, '.worktable')
  ];
  for (const dir of searchPaths) {
    if (fs.existsSync(dir)) {
      allFiles.push(...getMarkdownFiles(dir));
    }
  }
  return allFiles.map(fp => path.relative(wsRoot, fp).replace(/\\/g, '/'));
}

// Logging helper to stderr (stdout is strictly reserved for JSON-RPC messages)
function logDebug(message) {
  process.stderr.write(`[MCP Debug] ${message}\n`);
}

// Export core functions for Portal integration
module.exports = {
  listSpecs,
  searchSpecs,
  readSpecFile
};

// Standard JSON-RPC stdin/stdout Message Router
if (require.main === module) {
  let buffer = '';

  process.stdin.on('data', chunk => {
    buffer += chunk.toString();
    
    let lineEnd;
    while ((lineEnd = buffer.indexOf('\n')) !== -1) {
      const rawLine = buffer.slice(0, lineEnd).trim();
      buffer = buffer.slice(lineEnd + 1);
      
      if (rawLine === '') continue;
      
      try {
        const request = JSON.parse(rawLine);
        handleRequest(request);
      } catch (e) {
        logDebug(`Error parsing request JSON: ${e.message}. Raw message: ${rawLine}`);
        sendError(null, -32700, 'Parse error');
      }
    }
  });
}

function sendResponse(id, result) {
  const response = {
    jsonrpc: '2.0',
    id: id,
    result: result
  };
  process.stdout.write(JSON.stringify(response) + '\n');
}

function sendError(id, code, message) {
  const response = {
    jsonrpc: '2.0',
    id: id,
    error: {
      code: code,
      message: message
    }
  };
  process.stdout.write(JSON.stringify(response) + '\n');
}

function handleRequest(req) {
  const { jsonrpc, id, method, params } = req;
  
  if (jsonrpc !== '2.0') {
    return sendError(id, -32600, 'Invalid Request (Not JSON-RPC 2.0)');
  }
  
  logDebug(`Received request: method=${method}, id=${id}`);
  
  switch (method) {
    case 'initialize':
      return sendResponse(id, {
        protocolVersion: '2024-11-05',
        capabilities: {},
        serverInfo: {
          name: 'hana-spec-searcher',
          version: '1.0.0'
        }
      });
      
    case 'notifications/initialized':
      logDebug('MCP Connection Initialized');
      return;
      
    case 'tools/list':
      return sendResponse(id, {
        tools: [
          {
            name: 'list_specs',
            description: 'Lists all available markdown specification and task files in the workspace (specs/, governance/, legislation/, .worktable/).',
            inputSchema: {
              type: 'object',
              properties: {}
            }
          },
          {
            name: 'search_specs',
            description: 'Scans all project specifications and task files for target keywords or text patterns, returning matching file paths and line snippets.',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'The search term or keyword to scan for (e.g. "Batch 07", "eval", "excel-service").'
                }
              },
              required: ['query']
            }
          },
          {
            name: 'read_spec',
            description: 'Reads and returns the complete text content of a specific specification or markdown file inside the workspace.',
            inputSchema: {
              type: 'object',
              properties: {
                filePath: {
                  type: 'string',
                  description: 'Relative path of the target file inside the workspace (e.g. "specs/packages/layout/SPEC-LAYOUT.md").'
                }
              },
              required: ['filePath']
            }
          }
        ]
      });
      
    case 'tools/call':
      if (!params || !params.name) {
        return sendError(id, -32602, 'Invalid params: Missing tool name');
      }
      
      const { name, arguments: args } = params;
      logDebug(`Calling tool: ${name}`);
      
      try {
        if (name === 'list_specs') {
          const files = listSpecs();
          return sendResponse(id, {
            content: [{
              type: 'text',
              text: `Found ${files.length} specification files:\n` + files.map(f => `- ${f}`).join('\n')
            }]
          });
        }
        
        if (name === 'search_specs') {
          if (!args || typeof args.query !== 'string') {
            return sendError(id, -32602, 'Invalid params: query must be a string');
          }
          const matches = searchSpecs(args.query);
          let responseText = `Search Results for keyword "${args.query}":\n\n`;
          if (matches.length === 0) {
            responseText += 'No matches found.';
          } else {
            matches.forEach(m => {
              responseText += `File: [${m.filePath}](file:///${WORKSPACE_ROOT.replace(/\\/g, '/')}/${m.filePath})\n`;
              m.matches.forEach(l => {
                responseText += `  Line ${l.line}: ${l.text}\n`;
              });
              responseText += '\n';
            });
          }
          return sendResponse(id, {
            content: [{
              type: 'text',
              text: responseText
            }]
          });
        }
        
        if (name === 'read_spec') {
          if (!args || typeof args.filePath !== 'string') {
            return sendError(id, -32602, 'Invalid params: filePath must be a string');
          }
          const content = readSpecFile(args.filePath);
          return sendResponse(id, {
            content: [{
              type: 'text',
              text: content
            }]
          });
        }
        
        return sendError(id, -32601, `Method not found: tool ${name}`);
      } catch (err) {
        logDebug(`Error executing tool ${name}: ${err.message}`);
        return sendResponse(id, {
          content: [{
            type: 'text',
            text: `Error executing tool: ${err.message}`
          }],
          isError: true
        });
      }
      
    default:
      return sendError(id, -32601, `Method not found: ${method}`);
  }
}
