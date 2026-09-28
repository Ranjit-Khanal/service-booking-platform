import { randomUUID } from 'node:crypto';
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query('DELETE FROM bookings');
    await client.query('DELETE FROM time_slots');
    await client.query('DELETE FROM services');

    const services = [
      {
        id: randomUUID(),
        name: 'Classic Haircut',
        description: 'Precision cut with wash and style. 45 minutes with a senior stylist.',
        duration: 45,
        price: 4500,
      },
      {
        id: randomUUID(),
        name: 'Deep Tissue Massage',
        description: '60-minute therapeutic massage focused on tension release.',
        duration: 60,
        price: 9000,
      },
      {
        id: randomUUID(),
        name: 'Strategy Consultation',
        description: '90-minute 1:1 architecture / product strategy session.',
        duration: 90,
        price: 20000,
      },
    ];

    for (const s of services) {
      await client.query(
        `INSERT INTO services (id, name, description, duration_minutes, price_cents, currency, active)
         VALUES ($1,$2,$3,$4,$5,'USD', true)`,
        [s.id, s.name, s.description, s.duration, s.price],
      );

      for (let day = 0; day < 7; day++) {
        for (const hour of [10, 12, 14, 16]) {
          const starts = new Date();
          starts.setUTCHours(0, 0, 0, 0);
          starts.setUTCDate(starts.getUTCDate() + day);
          starts.setUTCHours(hour, 0, 0, 0);
          const ends = new Date(starts.getTime() + s.duration * 60_000);
          await client.query(
            `INSERT INTO time_slots (id, service_id, starts_at, ends_at, status, version)
             VALUES ($1,$2,$3,$4,'open',1)
             ON CONFLICT DO NOTHING`,
            [randomUUID(), s.id, starts.toISOString(), ends.toISOString()],
          );
        }
      }
    }

    console.log(`Seeded ${services.length} services with open slots`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
