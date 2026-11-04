// Нативный вариант поиска из dist/search.js для целочисленных евклидовых весов.
#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <cstdint>
#include <fstream>
#include <iostream>
#include <limits>
#include <memory>
#include <numeric>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <vector>
#if defined(_MSC_VER)
#include <intrin.h>
#endif

namespace {
constexpr int maxN = 30;
constexpr int infinity = std::numeric_limits<int>::max();
using Mask = std::uint32_t;
using Row = std::array<int, maxN>;
using Allowed = std::array<Mask, maxN>;
using Tour = std::vector<int>;
struct Point { int x, y; };
Mask bit(int i) { return Mask{1} << i; }
int firstBit(Mask bits) {
#if defined(_MSC_VER)
    unsigned long i;
    _BitScanForward(&i, bits);
    return static_cast<int>(i);
#else
    return __builtin_ctz(bits);
#endif
}
bool hasTwo(Mask bits) { return (bits & (bits - 1)) != 0; }

struct Path {
    std::array<std::uint8_t, maxN> ids{};
    int size = 0;
    int end() const { return ids[size - 1]; }
    void append(int city) { ids[size++] = static_cast<std::uint8_t>(city); }
};
struct Fork;
struct State {
    std::array<Path, 2> paths;
    std::array<int, 2> len{};
    Allowed allowed{};
    std::array<std::shared_ptr<Fork>, 2> forks{};
    Mask free = 0;
    int side = 0, bound = -1;
    bool open = true;
    int cost() const { return len[side]; }
    int length() const { return len[0] + len[1]; }
};
using Node = std::shared_ptr<State>;
struct Fork {
    // Слабые ссылки сохраняют порядок создания альтернатив и не удерживают обработанные узлы.
    std::vector<std::weak_ptr<State>> siblings;
    std::shared_ptr<Fork> previous;
    Node firstOpen() const {
        for (const auto& weak : siblings) {
            auto node = weak.lock();
            if (node && node->open) return node;
        }
        return {};
    }
};
class Queue {
public:
    std::vector<Node> items;
    void add(const Node& state) {
        size_t i = items.size();
        items.push_back(state);
        while (i) {
            const size_t parent = (i - 1) / 2;
            if (items[parent]->cost() <= state->cost()) break;
            items[i] = items[parent];
            i = parent;
        }
        items[i] = state;
    }
    Node take(Node state) {
        // Те же правила для равных стоимостей, что у очереди в браузере.
        if (state != items.front()) {
            auto it = std::find(items.begin(), items.end(), state);
            if (it == items.end()) throw std::logic_error("missing queued state");
            size_t i = static_cast<size_t>(it - items.begin());
            while (i) {
                const size_t parent = (i - 1) / 2;
                items[i] = items[parent];
                i = parent;
            }
        }
        Node last = items.back();
        items.pop_back();
        if (!items.empty()) {
            size_t i = 0;
            while (2 * i + 1 < items.size()) {
                size_t child = 2 * i + 1;
                if (child + 1 < items.size() && items[child + 1]->cost() < items[child]->cost()) ++child;
                if (last->cost() <= items[child]->cost()) break;
                items[i] = items[child];
                i = child;
            }
            items[i] = last;
        }
        return state;
    }
};

class Search {
    int n, a = 0, b = 1, globalBound = 0, queueLimit = 4000;
    std::int64_t checkpoint = 0, lastProgress = 0;
    std::array<Row, maxN> dist{}, near{};
    std::array<std::array<std::array<std::int8_t, maxN>, maxN>, maxN> turn{};
    std::array<std::array<Allowed, maxN>, maxN> blocked{};
    std::array<std::array<bool, maxN>, maxN> cached{};
    std::unordered_map<Mask, int> trees;
    std::unordered_map<std::uint64_t, int> seen;
    Queue queues[2];
    std::vector<Node> stack;
    Node next;
    bool retryFirst = false, seekingFirst = true, done = false;
    std::int64_t steps() const { return mainSteps + warmCycles; }
    int pending() const { return static_cast<int>(queues[0].items.size() + queues[1].items.size()); }
    int shorter(const State& s) const {
        if (s.paths[0].end() == b) return 1;
        if (s.paths[1].end() == b) return 0;
        return s.len[0] <= s.len[1] ? 0 : 1;
    }
    const Allowed& blockedBy(int from, int to) {
        if (from > to) std::swap(from, to);
        auto& row = blocked[from][to];
        if (cached[from][to]) return row;
        cached[from][to] = true;
        for (int i = 0; i < n; ++i) for (int j = i + 1; j < n; ++j) {
            if (turn[from][to][i] * turn[from][to][j] >= 0 || turn[i][j][from] * turn[i][j][to] >= 0) continue;
            const int crossed = dist[from][to] + dist[i][j];
            if (crossed <= std::max(dist[from][i] + dist[to][j], dist[from][j] + dist[to][i])) continue;
            row[i] |= bit(j);
            row[j] |= bit(i);
        }
        return row;
    }
    void extend(State& s, int side, int city) {
        const int from = s.paths[side].end();
        s.len[side] += dist[from][city];
        s.paths[side].append(city);
        const auto& mask = blockedBy(from, city);
        for (int i = 0; i < n; ++i) s.allowed[i] &= ~mask[i];
        s.free &= ~bit(city);
        s.side = side;
        s.bound = -1;
        s.open = true;
    }
    void close(State& s) {
        for (int side = 0; side < 2; ++side) if (s.paths[side].end() != b) extend(s, side, b);
    }
    Tour toTour(const State& s) const {
        const auto& out = s.paths[0];
        Tour tour(out.ids.begin(), out.ids.begin() + out.size);
        const auto& back = s.paths[1];
        for (int i = back.size - 2; i > 0; --i) tour.push_back(back.ids[i]);
        return tour;
    }
    static Tour cycleKey(Tour tour) {
        if (tour[1] > tour.back()) std::reverse(tour.begin() + 1, tour.end());
        return tour;
    }
    Tour insertionTour() {
        Tour tour{a, b};
        for (int k = n - 1; k >= 0; --k) {
            int city = near[a][k];
            if (city == a || city == b) continue;
            int least = infinity, position = 1;
            for (size_t i = 0; i < tour.size(); ++i) {
                ++insertionChecks;
                int u = tour[i], v = tour[(i + 1) % tour.size()];
                int extra = dist[u][city] + dist[city][v] - dist[u][v];
                if (extra < least) { least = extra; position = static_cast<int>(i) + 1; }
            }
            tour.insert(tour.begin() + position, city);
        }
        return tour;
    }
    Tour neighbor(const Tour& tour, const std::set<Tour>& visited) {
        int least = infinity;
        Tour result;
        for (int i = 0; i < n - 2; ++i) for (int j = i + 2; j < n; ++j) {
            if (i == 0 && j == n - 1) continue;
            ++twoOptChecks;
            int u = tour[i], v = tour[i + 1], x = tour[j], y = tour[(j + 1) % n];
            int delta = dist[u][x] + dist[v][y] - dist[u][v] - dist[x][y];
            if (delta >= least) continue;
            Tour candidate = tour;
            std::reverse(candidate.begin() + i + 1, candidate.begin() + j + 1);
            if (visited.count(cycleKey(candidate))) continue;
            least = delta;
            result = std::move(candidate);
        }
        return result;
    }
    void warmUp(int limit) {
        State seed = *next;
        while (seed.free) {
            int side = shorter(seed), end = seed.paths[side].end();
            for (int i = 0; i < n; ++i) {
                ++greedyChecks;
                int city = near[end][i];
                if (seed.free & bit(city)) { extend(seed, side, city); break; }
            }
        }
        close(seed);
        best = seed.length();
        bestTour = toTour(seed);
        bestStep = warmCycles = 1;
        if (limit == 1) return;
        std::set<Tour> visited{cycleKey(bestTour)};
        std::vector<Tour> trail{bestTour};
        auto consider = [&](const Tour& tour) {
            visited.insert(cycleKey(tour));
            trail.push_back(tour);
            State state = *next;
            const int split = static_cast<int>(std::find(tour.begin(), tour.end(), b) - tour.begin());
            for (int i = 1; i <= split; ++i) extend(state, 0, tour[i]);
            for (int i = n - 1; i >= split; --i) extend(state, 1, tour[i]);
            ++warmCycles;
            if (state.length() < best) { best = state.length(); bestStep = steps(); bestTour = tour; }
        };
        auto inserted = insertionTour();
        if (!visited.count(cycleKey(inserted))) consider(inserted);
        while (!trail.empty() && warmCycles < limit) {
            auto candidate = neighbor(trail.back(), visited);
            if (candidate.empty()) trail.pop_back();
            else consider(candidate);
        }
    }
    bool isBlocked(const State& s, int u, int v) const {
        Mask inner = s.free;
        if (u != b && v != b) inner |= bit(b);
        const Mask vertices = inner | bit(u) | bit(v);
        for (Mask bits = inner; bits; bits &= bits - 1) {
            if (!hasTwo(s.allowed[firstBit(bits)] & vertices)) return true;
        }
        const Mask exits = s.allowed[u] & inner;
        if (!exits || (u == v && !hasTwo(exits)) || !(s.allowed[v] & inner)) return true;
        Mask frontier = bit(firstBit(inner)), unseen = inner ^ frontier;
        while (frontier && unseen) {
            Mask reached = s.allowed[firstBit(frontier)] & unseen;
            frontier = (frontier & (frontier - 1)) | reached;
            unseen ^= reached;
        }
        return unseen != 0;
    }
    int treeLength(Mask free) {
        auto found = trees.find(free);
        if (found != trees.end()) return found->second;
        Row cost = dist[b];
        int length = 0;
        for (Mask left = free; left;) {
            int city = firstBit(left);
            for (Mask bits = left; bits; bits &= bits - 1) {
                const int i = firstBit(bits);
                if (cost[i] < cost[city]) city = i;
            }
            left &= ~bit(city);
            length += cost[city];
            for (Mask bits = left; bits; bits &= bits - 1) {
                const int i = firstBit(bits);
                cost[i] = std::min(cost[i], dist[city][i]);
            }
        }
        if (trees.size() < 16000) trees.emplace(free, length);
        return length;
    }
    int connection(int end, Mask remaining) const {
        for (int i = 0; i < n; ++i) {
            int city = near[end][i];
            if (remaining & bit(city)) return dist[end][city];
        }
        throw std::logic_error("missing connection");
    }
    int bound(State& s) {
        if (s.bound >= 0) return s.bound;
        const int u = s.paths[0].end(), v = s.paths[1].end();
        const Mask remaining = s.free | bit(b);
        s.bound = s.length() + std::max(dist[u][b] + dist[v][b],
            treeLength(s.free) + connection(u, remaining) + connection(v, remaining));
        return s.bound;
    }
    void progress() {
        const bool exhausted = !next && pending() == 0 && stack.empty();
        if (exhausted) globalBound = best;
        else if (steps() == checkpoint && globalBound < best) {
            int lower = next ? std::min(best, bound(*next)) : best;
            for (const auto* group : {&stack, &queues[0].items, &queues[1].items}) {
                for (const auto& state : *group) lower = std::min(lower, bound(*state));
            }
            if (lower > globalBound) { globalBound = lower; lastProgress = steps(); }
            if (globalBound < best && queueLimit < 16000 && pending() + int(stack.size()) >= queueLimit &&
                steps() - std::max(bestStep, lastProgress) >= 25000) {
                queueLimit *= 2;
                lastProgress = steps();
            }
            checkpoint += std::max<std::int64_t>(8, (mainSteps + 7) / 8);
        }
        done = globalBound >= best;
    }
    Node popStack() {
        auto node = stack.back();
        stack.pop_back();
        return node;
    }
    Node choose() {
        if (!stack.empty()) {
            if (retryFirst || queueLimit == 4000 || pending() >= queueLimit) {
                retryFirst = false;
                return popStack();
            }
            while (!stack.empty() && pending() < queueLimit) {
                auto node = popStack();
                queues[node->side].add(node);
            }
        }
        if (next && (seekingFirst || pending() >= queueLimit)) return std::move(next);
        int side = -1;
        for (int i = 0; i < 2; ++i) {
            if (queues[i].items.empty()) continue;
            const auto& alt = queues[i].items.front();
            if (next && alt->cost() > next->len[1 - i]) continue;
            if (side < 0 || alt->cost() < queues[side].items.front()->cost()) side = i;
        }
        if (side < 0) return std::move(next);
        auto node = queues[side].take(queues[side].items.front());
        if (next) queues[next->side].add(next);
        next.reset();
        return node;
    }
    void retryLonger(const State& s) {
        int side = s.len[0] >= s.len[1] ? 0 : 1;
        for (auto fork = s.forks[side]; fork; fork = fork->previous) {
            auto node = fork->firstOpen();
            if (!node) continue;
            auto it = std::find(stack.rbegin(), stack.rend(), node);
            if (it == stack.rend()) queues[side].take(node);
            else stack.erase(std::next(it).base());
            stack.push_back(node);
            retryFirst = true;
            return;
        }
    }
    void branch(const State& s) {
        const int side = shorter(s), end = s.paths[side].end(), other = s.paths[1 - side].end();
        std::vector<Node> children;
        for (int i = 0; i < n; ++i) {
            int city = near[end][i];
            if (!(s.free & bit(city)) && !(city == b && other != b)) continue;
            if (!(s.allowed[end] & bit(city))) { ++crossingCuts; continue; }
            auto child = std::make_shared<State>(s);
            extend(*child, side, city);
            if (!child->free) {
                bool blockedExit = false;
                for (const auto& path : child->paths) {
                    if (path.end() != b && !(child->allowed[path.end()] & bit(b))) blockedExit = true;
                }
                if (blockedExit) { ++crossingCuts; continue; }
            }
            children.push_back(child);
        }
        if (children.size() > 1) {
            auto fork = std::make_shared<Fork>();
            fork->previous = s.forks[side];
            fork->siblings.assign(children.begin(), children.end());
            for (const auto& child : children) child->forks[side] = fork;
        }
        if (pending() >= queueLimit || !stack.empty()) stack.insert(stack.end(), children.rbegin(), children.rend());
        else {
            next = children.empty() ? nullptr : children.front();
            for (size_t i = 1; i < children.size(); ++i) queues[side].add(children[i]);
        }
        if (children.empty()) retryLonger(s);
    }
    void step() {
        auto node = choose();
        State& s = *node;
        s.open = false;
        ++mainSteps;
        if (!s.free) {
            seekingFirst = false;
            // При закрытии не меняем флаг исходного узла в списках развилок.
            State completed = s;
            close(completed);
            if (completed.length() < best) {
                best = completed.length();
                bestTour = toTour(completed);
                bestStep = steps();
            }
        } else {
            int u = s.paths[0].end(), v = s.paths[1].end();
            auto key = (std::uint64_t(s.free) * n + std::min(u, v)) * n + std::max(u, v);
            auto found = seen.find(key);
            if (found != seen.end() && s.length() >= found->second) return;
            if (bound(s) >= best) { ++boundCuts; return; }
            if (isBlocked(s, u, v)) { ++deadEndCuts; retryLonger(s); return; }
            if (found != seen.end()) found->second = s.length();
            else if (seen.size() < 250000) seen.emplace(key, s.length());
            branch(s);
        }
    }
public:
    int best = infinity, warmCycles = 0;
    std::int64_t mainSteps = 0, bestStep = 0, boundCuts = 0, crossingCuts = 0, deadEndCuts = 0;
    int insertionChecks = 0, twoOptChecks = 0, greedyChecks = 0;
    Tour bestTour;
    explicit Search(const std::vector<Point>& points) : n(static_cast<int>(points.size())) {
        for (int i = 0; i < n; ++i) {
            for (int j = 0; j < n; ++j) {
                const std::int64_t dx = points[j].x - points[i].x, dy = points[j].y - points[i].y;
                dist[i][j] = static_cast<int>(std::ceil(std::sqrt(static_cast<double>(dx * dx + dy * dy))));
                for (int k = 0; k < n; ++k) {
                    auto cross = dx * (points[k].y - points[i].y) - dy * (points[k].x - points[i].x);
                    turn[i][j][k] = static_cast<std::int8_t>((cross > 0) - (cross < 0));
                }
            }
            std::iota(near[i].begin(), near[i].begin() + n, 0);
            std::stable_sort(near[i].begin(), near[i].begin() + n, [&](int u, int v) { return dist[i][u] < dist[i][v]; });
        }
        for (int i = 0; i < n; ++i) for (int j = i + 1; j < n; ++j) {
            if (dist[i][j] > dist[a][b]) { a = i; b = j; }
        }
        next = std::make_shared<State>();
        for (auto& path : next->paths) path.append(a);
        Mask full = bit(n) - 1;
        for (int i = 0; i < n; ++i) next->allowed[i] = full ^ bit(i);
        next->free = full ^ bit(a) ^ bit(b);
        globalBound = bound(*next);
    }
    void solve() {
        warmUp(n - 2);
        lastProgress = steps();
        checkpoint = steps() + 1;
        progress();
        while (!done) { step(); progress(); }
    }
};

std::vector<Point> readField(const char* filename) {
    std::ifstream in(filename);
    std::string line, norm;
    int n = 0;
    while (std::getline(in, line)) {
        std::replace(line.begin(), line.end(), ':', ' ');
        std::istringstream fields(line);
        std::string key;
        fields >> key;
        if (key == "DIMENSION") fields >> n;
        if (key == "EDGE_WEIGHT_TYPE") fields >> norm;
        if (key == "NODE_COORD_SECTION") break;
    }
    if (n < 3 || n > maxN || norm != "CEIL_2D") throw std::runtime_error("expected TSPLIB CEIL_2D, 3..30 cities");
    std::vector<Point> points(n);
    for (int i = 0; i < n; ++i) {
        int id;
        auto& p = points[i];
        if (!(in >> id >> p.x >> p.y) || id != i + 1 || p.x < -1000000 || p.x > 1000000 ||
            p.y < -1000000 || p.y > 1000000) throw std::runtime_error("invalid city coordinates or order");
    }
    return points;
}
}

int main(int argc, char** argv) {
    try {
        if (argc != 3) throw std::runtime_error("usage: khvastuns field.tsp tour.sol");
        auto points = readField(argv[1]);
        const auto start = std::chrono::steady_clock::now();
        auto run = std::make_unique<Search>(points);
        run->solve();
        const double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
        std::ofstream out(argv[2]);
        out << points.size() << '\n';
        for (int city : run->bestTour) out << city << ' ';
        out << '\n';
        out.close();
        if (!out) throw std::runtime_error("cannot write solution");
        std::cout << "{\"length\":" << run->best << ",\"mainSteps\":" << run->mainSteps
            << ",\"bestStep\":" << run->bestStep << ",\"warmupCount\":" << run->warmCycles
            << ",\"boundCuts\":" << run->boundCuts << ",\"crossingCuts\":" << run->crossingCuts
            << ",\"deadEndCuts\":" << run->deadEndCuts << ",\"insertionChecks\":" << run->insertionChecks
            << ",\"twoOptChecks\":" << run->twoOptChecks << ",\"greedyChecks\":" << run->greedyChecks
            << ",\"solveMs\":" << ms << "}\n";
        return 0;
    } catch (const std::exception& e) {
        std::cerr << e.what() << '\n';
        return 1;
    }
}
