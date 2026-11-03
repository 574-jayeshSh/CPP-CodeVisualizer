import bcrypt from "bcryptjs";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DEMO_SOURCE = `#include <iostream>
#include <vector>

struct Point {
  int x;
  int y;
};

int distanceSquared(const Point& a, const Point& b) {
  int dx = a.x - b.x;
  int dy = a.y - b.y;
  return dx * dx + dy * dy;
}

int main() {
  std::vector<Point> points = {{0, 0}, {3, 4}, {6, 8}};

  for (size_t i = 1; i < points.size(); ++i) {
    std::cout << distanceSquared(points[0], points[i]) << "\\n";
  }

  return 0;
}
`;

async function main() {
  const email = "demo@codelens.dev";

  const user = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name: "Demo User",
      passwordHash: await bcrypt.hash("demo1234", 10),
    },
  });

  const existing = await prisma.project.findFirst({
    where: { userId: user.id, name: "Sample: distance" },
  });

  if (!existing) {
    await prisma.project.create({
      data: {
        name: "Sample: distance",
        language: "cpp",
        sourceCode: DEMO_SOURCE,
        userId: user.id,
      },
    });
  }

  console.log(`Seeded demo user ${email} (password: demo1234)`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
