// SPDX-License-Identifier: AGPL-3.0-only
import { buildApp } from './composition/buildApp.js';
import { registerGracefulShutdown } from './shared/shutdown.js';

async function main(): Promise<void> {
  const { app, env, logger, db, redisStack, messaging } = await buildApp();

  const server = app.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, instanceId: env.INSTANCE_ID },
      'SlotBook API listening',
    );
  });

  registerGracefulShutdown({
    server,
    logger,
    resources: [messaging, redisStack, db],
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
