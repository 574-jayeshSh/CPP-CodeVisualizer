export const DEFAULT_SOURCE = `#include <iostream>
#include <string>
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
  std::string label = "distances:";

  std::cout << label << "\\n";

  for (size_t i = 1; i < points.size(); ++i) {
    std::cout << distanceSquared(points[0], points[i]) << "\\n";
  }

  return 0;
}
`;

export const EMPTY_SOURCE = "";
