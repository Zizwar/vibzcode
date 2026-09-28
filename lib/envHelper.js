const fs = require('fs');
const path = require('path');
const os = require('os');

/**
 * Searches for .env file across standard locations:
 * 1. Current working directory: process.cwd() + '/.env'
 * 2. Application root: path.join(__dirname, '..', '.env')
 * 3. User config home: path.join(os.homedir(), '.vibzcode', '.env')
 */
function findEnvFilePath() {
  const candidates = [
    path.join(process.cwd(), '.env'),
    path.join(__dirname, '..', '.env'),
    path.join(os.homedir(), '.vibzcode', '.env')
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  // Default target for new installations: current directory or ~/.vibzcode/.env
  return path.join(process.cwd(), '.env');
}

/**
 * Loads .env into process.env without overriding existing process.env variables
 */
function loadEnv() {
  const envPath = findEnvFilePath();
  if (!fs.existsSync(envPath)) {
    return { loaded: false, path: envPath };
  }

  try {
    const content = fs.readFileSync(envPath, 'utf8');
    const lines = content.split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx === -1) continue;
      const key = line.slice(0, eqIdx).trim();
      let val = line.slice(eqIdx + 1).trim();
      // Remove surrounding quotes if present
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key && !(key in process.env)) {
        process.env[key] = val;
      }
    }
    return { loaded: true, path: envPath };
  } catch (err) {
    console.warn(`[VibzCode Env] Error reading .env at ${envPath}:`, err.message);
    return { loaded: false, path: envPath, error: err.message };
  }
}

/**
 * Checks presence and readiness of essential and optional API keys
 */
function checkKeysStatus() {
  const gemini = !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
  const memoryz = !!(process.env.MEMORYZ_TOKEN || process.env.MEMORYZ_API_KEY);
  const jev = !!(process.env.JEV_AI_KEY && process.env.JEV_AI_KEY.trim());
  const openai = !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.trim());
  const anthropic = !!(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.trim());
  const adminPass = process.env.ADMIN_PASS || 'Vibz@123456';
  const isAdminDefault = adminPass === 'Vibz@123456' || adminPass === '@12345666';

  const envPath = findEnvFilePath();
  const hasEnvFile = fs.existsSync(envPath);

  // Ready if at least one AI capability (Gemini or MemoryZ) is configured, or user changed admin pass
  const isReady = gemini || memoryz;

  return {
    isReady,
    hasEnvFile,
    envPath,
    keys: {
      gemini: {
        configured: gemini,
        name: 'Google Gemini AI',
        envVar: 'GEMINI_API_KEY',
        description: 'مطلوب للمحرك التوليدي وتحليل الأكواد واستخلاص المهارات (مجاني من Google AI Studio)',
        docsUrl: 'https://aistudio.google.com/app/apikey'
      },
      memoryz: {
        configured: memoryz,
        name: 'MemoryZ Substrate',
        envVar: 'MEMORYZ_TOKEN',
        description: 'مطلوب لحفظ الذاكرة السيادية واسترجاع الخبرات والمهام التشاركية',
        docsUrl: 'https://memoryz.wino.deno.net'
      },
      jev: {
        configured: jev,
        name: 'TypeSafe Jev AI (اختياري)',
        envVar: 'JEV_AI_KEY',
        description: 'اختياري: لتوجيه وتقييم استهلاك التوكنات ونظام System One',
        docsUrl: 'https://typesafe.ai'
      },
      adminPass: {
        configured: !isAdminDefault,
        name: 'كلمة مرور لوحة الإدارة',
        envVar: 'ADMIN_PASS',
        description: isAdminDefault ? 'تحذير: كلمة المرور الافتراضية قيد الاستخدام (Vibz@123456)' : 'تم تعيين كلمة مرور مخصصة'
      }
    }
  };
}

/**
 * Safely updates or creates .env file with new keys and immediately updates process.env
 */
function saveKeys(updates = {}) {
  const envPath = findEnvFilePath();
  const dir = path.dirname(envPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let envLines = [];
  if (fs.existsSync(envPath)) {
    envLines = fs.readFileSync(envPath, 'utf8').split('\n');
  }

  const map = {
    geminiApiKey: 'GEMINI_API_KEY',
    memoryzToken: 'MEMORYZ_TOKEN',
    memoryzUrl: 'MEMORYZ_URL',
    jevApiKey: 'JEV_AI_KEY',
    adminPass: 'ADMIN_PASS',
    adminUser: 'ADMIN_USER'
  };

  const processed = new Set();

  for (const [keyParam, envVarName] of Object.entries(map)) {
    if (updates[keyParam] !== undefined && updates[keyParam] !== null) {
      const val = String(updates[keyParam]).trim();
      process.env[envVarName] = val; // Apply to runtime

      let found = false;
      for (let i = 0; i < envLines.length; i++) {
        const line = envLines[i].trim();
        if (line.startsWith(`${envVarName}=`)) {
          envLines[i] = `${envVarName}="${val}"`;
          found = true;
          break;
        }
      }
      if (!found && val) {
        envLines.push(`${envVarName}="${val}"`);
      }
      processed.add(envVarName);
    }
  }

  // Ensure trailing newline
  const newContent = envLines.filter(l => l !== undefined).join('\n').trim() + '\n';
  fs.writeFileSync(envPath, newContent, { encoding: 'utf8', mode: 0o600 }); // Restrict file permissions
  return { success: true, envPath, updatedCount: processed.size };
}

module.exports = {
  findEnvFilePath,
  loadEnv,
  checkKeysStatus,
  saveKeys
};
