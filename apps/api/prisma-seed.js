const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

const ADMIN_EMAIL = 'admin@example.com';
const ADMIN_PASSWORD = 'Admin123!';
const ADMIN_NAME = 'System Admin';

async function seedInstruments() {
  const ring180 = await prisma.instrumentRing.upsert({
    where: { code: '180环形圈' },
    update: {},
    create: { name: '180环形圈', code: '180环形圈', diameterMm: 180, isActive: true },
  });
  const ring200 = await prisma.instrumentRing.upsert({
    where: { code: '200环形圈' },
    update: {},
    create: { name: '200环形圈', code: '200环形圈', diameterMm: 200, isActive: true },
  });

  const rod155 = await prisma.instrumentRod.upsert({
    where: { code: '155双套连杆' },
    update: {},
    create: { name: '155双套连杆', code: '155双套连杆', lengthMm: 155, isActive: true },
  });
  const rod180 = await prisma.instrumentRod.upsert({
    where: { code: '180双套连杆' },
    update: {},
    create: { name: '180双套连杆', code: '180双套连杆', lengthMm: 180, isActive: true },
  });

  const ringIds = [ring180.id, ring200.id];
  const rodIds = [rod155.id, rod180.id];
  const comboRodIds = Array(6).fill(rod155.id);

  await prisma.instrumentCombination.upsert({
    where: { code: '双环型' },
    update: {},
    create: { name: '双环型', code: '双环型', ringRefIds: ringIds, rodRefIds: comboRodIds, isActive: true },
  });
  await prisma.instrumentCombination.upsert({
    where: { code: '6+6' },
    update: {},
    create: { name: '6+6', code: '6+6', ringRefIds: [ring180.id], rodRefIds: comboRodIds, isActive: true },
  });
  await prisma.instrumentCombination.upsert({
    where: { code: '6*6(1)' },
    update: {},
    create: { name: '6*6(1)', code: '6*6(1)', ringRefIds: [ring180.id], rodRefIds: comboRodIds, isActive: true },
  });
  await prisma.instrumentCombination.upsert({
    where: { code: '6*6(2)' },
    update: {},
    create: { name: '6*6(2)', code: '6*6(2)', ringRefIds: [ring180.id], rodRefIds: comboRodIds, isActive: true },
  });
  console.log('Instrument rings, rods, combinations seeded.');
}

async function main() {
  const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { role: 'ADMIN', passwordHash: hash, name: ADMIN_NAME },
    create: {
      email: ADMIN_EMAIL,
      passwordHash: hash,
      name: ADMIN_NAME,
      role: 'ADMIN',
    },
  });
  console.log('Admin user ready:', admin.email, '| Password:', ADMIN_PASSWORD);
  await seedInstruments();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
