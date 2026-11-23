'use strict';
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const pino = require('pino');
const pinoHttp = require('pino-http');
const { config } = require('./config');
const mw = require('./middleware');
const { HttpError } = require('./http');

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);

  const logger = pino({ level: config.logLevel, redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'] });
  app.use(mw.requestContext);
  app.use(pinoHttp({
    logger, genReqId: req => req.id,
    autoLogging: { ignore: req => req.url === '/api/health' || req.url.startsWith('/assets/') },
    serializers: { req: req => ({ id: req.id, method: req.method, url: req.url.split('?')[0], ip: req.remoteAddress }), res: res => ({ status: res.statusCode }) },
    customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
  }));
  app.use(mw.securityHeaders);
  app.use(mw.permissionsPolicy);
  app.use(express.json({ limit: '200kb' }));
  app.use(cookieParser());

  const api = express.Router();
  api.use(mw.noStore);
  api.use(mw.apiLimiter);
  api.use(mw.originGuard);
  api.use('/auth/login', mw.loginLimiter);
  api.use('/auth/mfa/verify', mw.loginLimiter);
  api.use('/auth', require('./routes/auth'));
  const red = require('./routes/red');
  api.use('/red', red.signed);
  api.use('/public/red', red.publicInvites);
  for (const file of ['profiles', 'members', 'attendance', 'corrections', 'training', 'admin']) api.use(require(`./routes/${file}`));
  api.use((_req, _res, next) => next(new HttpError(404, 'API route not found.')));
  app.use('/api', api);

  const buildDir = path.join(__dirname, '..', 'build');
  app.use('/assets', express.static(path.join(buildDir, 'assets'), { immutable: true, maxAge: '1y', index: false }));
  app.use(express.static(buildDir, { index: false, maxAge: '1h', setHeaders: (res, file) => { if (/(sw\.js|index\.html|manifest\.json)$/.test(file)) res.setHeader('Cache-Control', 'no-cache'); } }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next();
    res.setHeader('Cache-Control', 'no-cache');
    return res.sendFile(path.join(buildDir, 'index.html'), error => { if (error) next(new HttpError(404, 'Frontend build not found. Run: npm run build')); });
  });
  app.use(mw.errorHandler);
  return app;
}

module.exports = { createApp };
