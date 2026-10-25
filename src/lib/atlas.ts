// The travel map, drawn at build time: Natural Earth countries (world-atlas) projected
// with Equal Earth into plain SVG paths, so the page ships no map library. The 1:110m
// set draws the world; countries too small to be in it (Singapore, Maldives, Bahrain)
// come from the 1:50m set, and anything too small to see gets a dot.
import { geoEqualEarth, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { GeometryCollection, Topology } from 'topojson-specification';
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import coarse from 'world-atlas/countries-110m.json';
import fine from 'world-atlas/countries-50m.json';

type Country = Feature<Geometry, { name: string }>;

const countries = (json: unknown): Country[] => {
  const topo = json as Topology<{ countries: GeometryCollection<{ name: string }> }>;
  return (feature(topo, topo.objects.countries) as FeatureCollection<Geometry, { name: string }>).features;
};

const world = countries(coarse).filter((c) => c.properties.name !== 'Antarctica');
const extra = countries(fine);

export const WIDTH = 1000;
const projection = geoEqualEarth().fitWidth(WIDTH, { type: 'FeatureCollection', features: world });
const path = geoPath(projection).digits(1);
export const HEIGHT = Math.ceil(path.bounds({ type: 'FeatureCollection', features: world })[1][1]);

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z]/g, '');

// everyday names for the ones Natural Earth spells differently
const ALIASES: Record<string, string> = {
  usa: 'United States of America', us: 'United States of America', unitedstates: 'United States of America', america: 'United States of America',
  uk: 'United Kingdom', greatbritain: 'United Kingdom', britain: 'United Kingdom', england: 'United Kingdom', scotland: 'United Kingdom', wales: 'United Kingdom',
  uae: 'United Arab Emirates', dubai: 'United Arab Emirates',
  czechrepublic: 'Czechia', turkiye: 'Turkey', burma: 'Myanmar', korea: 'South Korea', eastimor: 'Timor-Leste',
  northmacedonia: 'Macedonia', swaziland: 'eSwatini', ivorycoast: "Côte d'Ivoire", capeverde: 'Cabo Verde', holland: 'Netherlands',
  vaticancity: 'Vatican', dominicanrepublic: 'Dominican Rep.', bosniaandherzegovina: 'Bosnia and Herz.',
  democraticrepublicofthecongo: 'Dem. Rep. Congo', drc: 'Dem. Rep. Congo', republicofthecongo: 'Congo',
  centralafricanrepublic: 'Central African Rep.', equatorialguinea: 'Eq. Guinea', southsudan: 'S. Sudan',
  westernsahara: 'W. Sahara', solomonislands: 'Solomon Is.', falklandislands: 'Falkland Is.', faroeislands: 'Faeroe Is.',
  antiguaandbarbuda: 'Antigua and Barb.', saintvincentandthegrenadines: 'St. Vin. and Gren.', saintkittsandnevis: 'St. Kitts and Nevis',
  saotomeandprincipe: 'São Tomé and Principe', frenchpolynesia: 'Fr. Polynesia', caymanislands: 'Cayman Is.',
};

const byName = new Map<string, Country>();
for (const c of extra) byName.set(norm(c.properties.name), c);
for (const c of world) byName.set(norm(c.properties.name), c);

const find = (name: string) => {
  const key = norm(name);
  return byName.get(key) ?? byName.get(norm(ALIASES[key] ?? ''));
};

export const slug = (name: string) => norm(find(name)?.properties.name ?? name);

export interface Shape {
  id: string;
  d: string;
  // where its label points: the middle of its largest piece (mainland USA, not
  // somewhere between Alaska and Hawaii)
  at: [number, number];
  // too small to see, so it's drawn as a dot at `at`
  dot: boolean;
}

const round = (n: number) => Math.round(n * 10) / 10;

function middle(c: Country): [number, number] {
  const g = c.geometry;
  const parts: Feature[] =
    g.type === 'MultiPolygon'
      ? g.coordinates.map((coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates } }))
      : [c];
  const biggest = parts.reduce((a, b) => (path.area(b) > path.area(a) ? b : a));
  const [x, y] = path.centroid(biggest);
  return [round(x), round(y)];
}

export function atlas(visited: string[]) {
  const shapes = new Map<string, Shape>();
  for (const name of visited) {
    const c = find(name);
    if (!c) {
      throw new Error(
        `travel.toml: no country called "${name}" on the map. Use its Natural Earth name (e.g. "United States of America", "Czechia") or a common short form ("USA", "UK", "UAE").`,
      );
    }
    const id = norm(c.properties.name);
    shapes.set(id, { id, d: path(c) ?? '', at: middle(c), dot: path.area(c) < 24 });
  }

  const land = world
    .map((c) => ({ id: norm(c.properties.name), d: path(c) ?? '' }))
    .filter((c) => !shapes.has(c.id));

  return { land, shapes };
}
