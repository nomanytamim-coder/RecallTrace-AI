import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { generateRecallReport } from './server/recallAssistantService';
import { fetchLiveRecalls } from './server/outbreakService';
import {
  analyzeOutbreakWithGemini,
  askGeminiInvestigation,
  getGeminiConfigStatus,
} from './server/geminiService';

function recallAssistantApiPlugin(): Plugin {
  return {
    name: 'recall-assistant-api',
    configureServer(server) {
      // Outbreak intelligence and openFDA Food Recalls endpoint
      server.middlewares.use('/api/outbreaks', async (req, res) => {
        try {
          const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
          const forceRefresh = url.searchParams.get('refresh') === 'true' || req.method === 'POST';

          const data = await fetchLiveRecalls(forceRefresh);

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'public, max-age=60');
          res.end(JSON.stringify({ success: true, ...data }));
        } catch (err: any) {
          console.error('Error in /api/outbreaks:', err);
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: false, error: err.message || 'Internal server error' }));
        }
      });

      // Gemini Outbreak Report Analysis endpoint
      server.middlewares.use('/api/analyze-outbreak', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: false, error: 'Method not allowed. Use POST.' }));
          return;
        }

        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });

        req.on('end', async () => {
          try {
            const parsed = JSON.parse(body || '{}');
            const { outbreakId, userInstruction } = parsed;

            if (!outbreakId) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  success: false,
                  error: 'Missing required field: outbreakId.',
                })
              );
              return;
            }

            const result = await analyzeOutbreakWithGemini(outbreakId, userInstruction);

            res.statusCode = result.success ? 200 : result.error?.includes('Unavailable') ? 503 : 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(result));
          } catch (err: any) {
            console.error('Error in /api/analyze-outbreak:', err);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: false, error: err.message || 'Internal server error' }));
          }
        });
      });

      // Gemini Interactive Investigation Assistant endpoint
      server.middlewares.use('/api/ask-gemini', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: false, error: 'Method not allowed. Use POST.' }));
          return;
        }

        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });

        req.on('end', async () => {
          try {
            const parsed = JSON.parse(body || '{}');
            const { outbreakId, question } = parsed;

            if (!outbreakId || !question) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(
                JSON.stringify({
                  success: false,
                  error: 'Missing required fields: outbreakId and question are required.',
                })
              );
              return;
            }

            const result = await askGeminiInvestigation(outbreakId, question);

            res.statusCode = result.success ? 200 : result.error?.includes('Unavailable') ? 503 : 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(result));
          } catch (err: any) {
            console.error('Error in /api/ask-gemini:', err);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: false, error: err.message || 'Internal server error' }));
          }
        });
      });

      // Gemini Configuration Status endpoint
      server.middlewares.use('/api/gemini-status', async (_req, res) => {
        const status = getGeminiConfigStatus();
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true, ...status }));
      });

      // Legacy endpoint for backward compatibility
      server.middlewares.use('/api/generate-recall-report', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'Method not allowed' }));
          return;
        }

        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });

        req.on('end', async () => {
          try {
            const parsed = JSON.parse(body || '{}');
            const traceResult = parsed.traceResult;

            if (!traceResult) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ success: false, error: 'Missing traceResult in request body' }));
              return;
            }

            const apiKey = process.env.GEMINI_API_KEY;
            const report = await generateRecallReport(traceResult, apiKey);

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: true, report, sourceMode: report.sourceMode }));
          } catch (err: any) {
            console.error('Error in /api/generate-recall-report:', err);
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ success: false, error: err.message || 'Internal server error' }));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    recallAssistantApiPlugin(),
  ],
  server: {
    port: 5173,
    host: true,
  },
});
