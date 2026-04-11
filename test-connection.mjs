import { readFileSync } from 'fs';

// Load .env file manually
try {
  const envContent = readFileSync('.env', 'utf8');
  envContent.split('\n').forEach(line => {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      const value = match[2].trim().replace(/\s+#.*$/, '');
      if (key && value) {
        process.env[key] = value;
      }
    }
  });
} catch (e) {
  console.log('No .env file found');
}

const url = process.env.METABASE_URL?.replace(/\/$/, '');
const apiKey = process.env.METABASE_API_KEY;

if (!url) {
  console.log('ERROR: METABASE_URL is required.');
  console.log('Set it in your .env file or environment.');
  process.exit(1);
}

console.log('Testing Metabase connection...');
console.log('URL:', url);
console.log('Mode:', process.env.MCP_MODE || 'read (default)');
console.log('');

if (!apiKey) {
  console.log('ERROR: METABASE_API_KEY is required.');
  console.log('Set it in your .env file or environment.');
  process.exit(1);
}

console.log('API Key:', apiKey.substring(0, 15) + '...');
console.log('');

const headers = {
  'X-API-Key': apiKey,
};

try {
  // Test health endpoint
  const healthResponse = await fetch(`${url}/api/health`, { headers });

  if (!healthResponse.ok) {
    console.log('Health check failed:', healthResponse.status);
    const body = await healthResponse.text();
    console.log(body.substring(0, 500));
    process.exit(1);
  }

  console.log('Health check: OK');

  // List databases
  const dbResponse = await fetch(`${url}/api/database`, { headers });

  if (!dbResponse.ok) {
    console.log('Database fetch failed:', dbResponse.status, await dbResponse.text());
    process.exit(1);
  }

  const databases = await dbResponse.json();
  const dbList = databases.data || databases;

  console.log(`\nConnected successfully! Found ${dbList.length} database(s):\n`);
  dbList.forEach(db => {
    console.log(`  [${db.id}] ${db.name} (${db.engine})${db.is_sample ? ' - Sample' : ''}`);
  });

  // List some dashboards
  const dashResponse = await fetch(`${url}/api/dashboard`, { headers });

  if (dashResponse.ok) {
    const dashboards = await dashResponse.json();
    console.log(`\nFound ${dashboards.length} dashboard(s):`);
    dashboards.slice(0, 5).forEach(d => {
      console.log(`  [${d.id}] ${d.name}`);
    });
    if (dashboards.length > 5) {
      console.log(`  ... and ${dashboards.length - 5} more`);
    }
  }

  console.log('\nConnection test successful! The MCP server is ready to use.');

} catch (err) {
  console.log('\nx Connection failed:', err.message);
  process.exit(1);
}
