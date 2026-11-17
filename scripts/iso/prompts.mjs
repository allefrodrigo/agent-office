// Prompts for `npm run arte:iso`: what Codex (image_gen) draws for each sprite of the 2D view.
// Every drawing faces the same way, so the view can mirror it for the other diagonal:
//   front art: the object's front faces the viewer's LOWER-RIGHT (its length runs from the
//              upper-right to the lower-left);
//   back art ("-back"): the same object seen from behind, its BACK facing the lower-right.
// A floor tile is 64 x 32 view pixels; a tile of height is 40.

export const ISO_STYLE = `Original isometric pixel-art game sprite for "Agent Office", a cozy office management game.
Camera: 2:1 dimetric isometric view from above (edges going sideways rise 1 pixel every 2 pixels), the classic isometric pixel-art angle. The floor grid diamonds are 64 pixels wide and 32 tall.
Our house style: chunky friendly shapes with slightly rounded corners, a warm modern palette (honey and walnut wood, warm whites, charcoal metal, teal, coral and mustard accents), crisp hard-edged pixel art with clearly visible square pixels, a 1-pixel dark brown-gray outline around the object (not black), flat colors with 3-tone shading, light from the top-left, top faces lightest, a 1-pixel light highlight on the top edges. No anti-aliasing, no blur, no gradients, no texture noise.
ONE object only, whole, centered, filling most of the image. No floor, no floor tile, no wall, no shadow, no text, no letters, no logos, no labels, no people.
Background: perfectly flat solid pure green #00FF00 over the whole canvas (chroma key). Never use green #00FF00 in the object.`

const FRONT = 'Facing: its front faces the viewer\'s LOWER-RIGHT; its length runs along the diagonal from the upper-right to the lower-left.'
const BACK = 'Facing: seen from BEHIND, its back faces the viewer\'s LOWER-RIGHT (its front faces away, to the upper-left); its length runs along the diagonal from the upper-right to the lower-left.'
const WALL = 'It hangs flat on a wall that runs from the upper-right to the lower-left (the wall itself is NOT drawn); its face looks to the viewer\'s LOWER-RIGHT, so it appears as a slanted parallelogram rising to the right.'
const ROUND = 'It is round or symmetric, seen from the isometric angle above.'

/**
 * `size`: [length, depth, height] in floor tiles; the length runs along the art's upper-right to
 * lower-left diagonal, the depth from its front to its back. It sets the blockout Codex draws
 * into and the sprite width ((length + depth) x 32 pixels).
 */
const job = (size, how, what) => ({ size, w: Math.max(10, Math.round((size[0] + size[1]) * 32)), prompt: `${what}\n${how}` })

/**
 * The ruler: drawn first, it rides along with every other drawing as the style reference. The
 * executive desk, not the work desk: the work desk was redrawn in 0.4.0-beta.6 and still needs
 * a reference from the first set.
 */
export const RULER = 'bossDesk'

export const ISO_JOBS = {
  // ---------- desks and computers ----------
desk: job([2, 1, 0.75], FRONT, 'A modern sit-stand office desk, two floor tiles long and one deep, the kind tech startups use: a smooth light honey-oak top with softly rounded corners, a black powder-coated steel frame with two slim telescopic legs on flat T-shaped feet joined by a thin crossbar, a black cable tray under the back edge. The top is empty.'),
'desk-white': job([2, 1, 0.75], FRONT, 'A modern sit-stand office desk, two floor tiles long and one deep, the kind tech startups use: a smooth warm white top with softly rounded corners, a warm white powder-coated steel frame with two slim telescopic legs on flat T-shaped feet joined by a thin crossbar, a light-gray cable tray under the back edge. The top is empty.'),
'desk-dark': job([2, 1, 0.75], FRONT, 'A modern sit-stand office desk, two floor tiles long and one deep, the kind tech startups use: a smooth dark walnut top with softly rounded corners, a black powder-coated steel frame with two slim telescopic legs on flat T-shaped feet joined by a thin crossbar, a black cable tray under the back edge. The top is empty.'),
bossDesk: job([2.4, 1.1, 0.78], FRONT, 'A big executive desk, wider than a normal desk: dark walnut wood with a thin brass trim line, a solid front modesty panel, drawers on both sides. The top is empty.'),
  monitor: job(
    [0.6, 0.2, 0.55],
    FRONT,
    'A slim flat computer monitor on a small charcoal stand with a round foot. The whole screen area is ONE flat magenta #FF00FF rectangle (no reflection, no image on it), surrounded by a thin charcoal bezel.',
  ),
'monitor-back': job([0.6, 0.2, 0.55], BACK, 'The same slim flat computer monitor seen from BEHIND: the charcoal back cover with a few vent lines and the small stand with a round foot. No screen visible.'),
keyboard: job([0.5, 0.2, 0.04], FRONT, 'A slim light-gray computer keyboard with dark gray keys lying flat, and a small light-gray mouse beside its right end.'),
laptop: job([0.4, 0.3, 0.25], FRONT, 'An open silver laptop: the keyboard deck lies flat, the lid stands up behind it with a dark blue-gray screen.'),
deskLamp: job([0.25, 0.25, 0.45], FRONT, 'A small adjustable desk lamp: a round charcoal base, a thin bent mustard-yellow metal arm, a small cone shade pointing down and forward.'),
mug: job([0.1, 0.1, 0.12], FRONT, 'A plain coral-red coffee mug with a handle on the right side, dark coffee inside.'),
paperStack: job([0.25, 0.3, 0.06], FRONT, 'A neat stack of white paper sheets, slightly uneven, a yellow sticky note on top.'),

  // ---------- chairs ----------
officeChair: job([0.62, 0.62, 1.05], FRONT, 'A premium ergonomic mesh office task chair: a tall curved backrest of dark graphite mesh stretched on a slim black frame, a lumbar support pad across the lower back, a matching graphite mesh seat with a rounded waterfall front edge, height-adjustable black armrests with padded tops, a gas lift post and a polished aluminum five-star base on black casters.'),
'officeChair-back': job([0.62, 0.62, 1.05], BACK, 'The same premium ergonomic mesh office task chair seen from BEHIND: the back of the tall curved dark graphite mesh backrest on its slim black frame, the lumbar support pad, the black armrests, the gas lift post and the polished aluminum five-star base on black casters.'),
meetingChair: job([0.55, 0.55, 0.95], FRONT, 'A modern mid-back conference chair: a light-gray mesh backrest on a slim polished aluminum frame, a padded seat in warm gray fabric, slim polished aluminum armrests, one post on a polished aluminum four-star base on small glides (no wheels).'),
'meetingChair-back': job([0.55, 0.55, 0.95], BACK, 'The same modern mid-back conference chair seen from BEHIND: the back of the light-gray mesh backrest on its slim polished aluminum frame, the armrests, the post and the polished aluminum four-star base.'),
bossChair: job([0.7, 0.7, 1.2], FRONT, 'A big executive office chair: high padded backrest and seat in cognac-brown leather with tufted seams, charcoal armrests, a five-star chrome base on wheels.'),
'bossChair-back': job([0.7, 0.7, 1.2], BACK, 'The same big cognac-brown leather executive chair seen from BEHIND: the tall padded back, armrests, the five-star chrome base on wheels.'),
simpleChair: job([0.5, 0.5, 0.9], FRONT, 'A simple modern dining chair: honey-oak wooden legs and frame, a coral upholstered seat cushion and backrest panel.'),
'simpleChair-back': job([0.5, 0.5, 0.9], BACK, 'The same simple dining chair seen from BEHIND: honey-oak legs and frame, the back of the coral backrest panel.'),
stool: job([0.45, 0.45, 0.75], ROUND, 'A tall bar stool: a round mustard-yellow cushioned seat on four thin charcoal metal legs with a footrest ring.'),
beanBag: job([0.8, 0.8, 0.55], FRONT, 'A big soft bean bag chair in teal fabric, slumped into a comfy seat shape with a dent in the middle.'),

  // ---------- lounge ----------
sofa3: job([3, 1, 0.8], FRONT, 'A three-seat sofa, three floor tiles long: plump teal fabric cushions, a low backrest along its back, rounded arms at both ends, small honey-oak wooden feet.'),
'sofa3-back': job([3, 1, 0.8], BACK, 'The same three-seat teal sofa seen from BEHIND: the back of the backrest, the rounded arms at both ends, small wooden feet.'),
sofa2: job([2, 1, 0.8], FRONT, 'A two-seat sofa, two floor tiles long: plump teal fabric cushions, a low backrest along its back, rounded arms at both ends, small honey-oak wooden feet.'),
'sofa2-back': job([2, 1, 0.8], BACK, 'The same two-seat teal sofa seen from BEHIND: the back of the backrest, the rounded arms at both ends, small wooden feet.'),
armchair: job([1, 1, 0.8], FRONT, 'One cozy upholstered armchair: plump teal fabric seat and back, rounded arms, small honey-oak wooden feet.'),
'armchair-back': job([1, 1, 0.8], BACK, 'The same cozy teal armchair seen from BEHIND: the back of the backrest and the rounded arms, small wooden feet.'),
coffeeTable: job([1.4, 0.7, 0.4], FRONT, 'A low rectangular coffee table: a honey-oak wooden top with rounded corners, a lower shelf with two small books, short charcoal legs.'),
lowTable: job([0.7, 0.7, 0.45], ROUND, 'A small low round side table: a white top on three slim honey-oak legs.'),
roundTable: job([1, 1, 0.75], ROUND, 'A round cafe table for four: a white round top on a single charcoal pedestal with a round foot.'),
barTable: job([0.7, 0.7, 1.05], ROUND, 'A tall round standing bar table: a round honey-oak top on a single chrome pole with a flat round chrome base.'),
meetingTable: job([3.5, 1.6, 0.75], FRONT, 'A big conference table for eight people: a wide rectangular top about twice as long as it is wide, smooth walnut wood with a lighter edge, at desk height on two solid charcoal panel legs near the ends.'),
floorLamp: job([0.4, 0.4, 1.6], ROUND, 'A tall floor lamp: a round charcoal base, a thin brass pole, a cream fabric drum shade on top.'),
bookshelf: job([1.6, 0.45, 1.9], FRONT, 'A tall wooden bookshelf against a wall: honey-oak frame with four shelves full of colorful books (teal, coral, mustard, navy), a small plant pot on the top shelf.'),
arcade: job([0.9, 0.8, 1.7], FRONT, 'A retro arcade cabinet: a tall cabinet painted in coral and navy with abstract geometric side art, a dark screen glowing teal, a control panel with a joystick and colorful round buttons.'),
foosball: job([1.5, 0.8, 0.9], FRONT, 'A foosball table: a long honey-oak wooden cabinet on four legs, a green playing field with white lines inside, silver rods across the field with small coral and teal player figures, black rod handles sticking out of both long sides.'),
pingPong: job([2.5, 1.4, 0.75], FRONT, 'A ping-pong table: a teal table top with white border lines and a white center line, a low white net across the middle, four charcoal metal legs, two coral paddles and a small white ball lying on top.'),

  // ---------- kitchen and services ----------
fridge: job([0.9, 0.8, 1.9], FRONT, 'A tall modern two-door refrigerator in warm white with slim charcoal vertical handles, freezer on top.'),
microwave: job([0.5, 0.35, 0.3], FRONT, 'A small countertop microwave oven: warm white body, a dark glass door on the left, a small control panel with a dial on the right.'),
coffeeMachine: job([0.35, 0.35, 0.4], FRONT, 'A compact espresso coffee machine: charcoal and brushed steel body, a small spout over a drip tray with a tiny white cup.'),
  kitchenCounter: job(
    [1, 0.7, 0.9],
    FRONT,
    'ONE module of a kitchen counter, exactly one floor tile long: a lower cabinet with a warm white door and a charcoal handle, a light-gray stone countertop on top. Simple and modular so copies can line up side by side.',
  ),
wallCabinets: job([1, 0.35, 0.6], WALL, 'ONE module of a kitchen wall cupboard: a warm white box with two doors and two small charcoal handles, a light-gray bottom edge.'),
waterCooler: job([0.5, 0.5, 1.3], FRONT, 'An office water cooler: a white stand with a big upside-down light-blue water bottle on top, a blue tap and a coral tap on the front, a drip tray, a stack of paper cups on one side.'),
printer: job([0.8, 0.6, 1], FRONT, 'An office copier-printer on a small cabinet: light-gray body, a dark paper tray on top, a small control panel with a teal screen, a paper drawer in front.'),
cabinet: job([1.2, 0.5, 0.8], FRONT, 'A low office filing cabinet: honey-oak wood, three wide drawers with charcoal handles.'),
trash: job([0.35, 0.35, 0.4], ROUND, 'A small round office trash bin in charcoal metal mesh, a crumpled paper ball inside.'),
clock: job([0.5, 0.05, 0.5], WALL, 'A round wall clock: warm white face, charcoal hour marks and hands, a thin honey-oak wooden frame.'),

  // ---------- carried by hand (deliveries) ----------
  'carry-report': job([0.3, 0.05, 0.4], FRONT, 'A single sheet of white paper held upright like a finished report: a green header band at the top, a few gray text lines below, a small green check mark. Slightly curled corner.'),
  'carry-alert': job([0.3, 0.05, 0.4], FRONT, 'A single sheet of pale pink paper held upright like an urgent request: a coral-red header band at the top, a few gray text lines below, a small red exclamation mark.'),

  // ---------- startup pieces (0.4.0-beta.6) ----------
phoneBooth: job([1, 1, 2.1], FRONT, 'A one-person acoustic phone booth pod of a modern office, one floor tile wide and deep: a tall box with honey-oak wooden outer walls and a flat roof, the whole front is a glass door in a slim black frame with a long black bar handle; through the glass, charcoal felt acoustic walls inside, a small oak shelf-desk and a round stool, a warm little light on the ceiling.'),
sectional: job([3, 1.8, 0.8], FRONT, 'A big L-shaped sectional sofa, three floor tiles long: plump terracotta-rust fabric seat and back cushions, a low backrest along its back, a chaise longue extending toward the front at its lower-left end, low rounded arms, small honey-oak wooden feet, two mustard-yellow throw pillows.'),
bleachers: job([3, 2, 1.1], FRONT, 'Wooden amphitheater bleacher seating like tech startups have for all-hands talks, three floor tiles long and two deep: three broad steps rising from the front to the back, built from light honey-oak boards, loose square seat cushions in teal, mustard and coral on the steps, two small potted plants on the top step.'),
communalTable: job([3, 1.6, 0.75], FRONT, 'A long communal dining table of a startup cafe, three floor tiles long: a thick solid light-oak top with rounded corners on black steel trestle legs, with two matching long light-oak benches, one along each long side, tucked a little under the top. The top is empty.'),
kitchenIsland: job([3, 1, 0.95], FRONT, 'A kitchen island of an office cafe, three floor tiles long and one deep: warm white flat cabinet doors with slim charcoal handles, a thick light-gray stone countertop that overhangs the front side for bar stools, a small round steel sink with a tall tap near one end, a wooden bowl with oranges near the other.'),
shelfDivider: job([2, 0.45, 1.5], FRONT, 'An open shelving unit used as a room divider in a modern office, two floor tiles long and open from both sides: a slim black metal frame with three light-oak shelves holding potted plants (one with pothos vines trailing down), a few books lying and standing, small ceramic vases in terracotta and white.'),
greenWall: job([2, 0.12, 1.2], WALL, 'A living plant wall panel: a wide rectangle densely covered in moss and lush plants (ferns, pothos, small leafy plants) in many shades of green, a thin honey-oak wooden frame around it.'),
credenza: job([2, 0.5, 0.65], FRONT, 'A low modern media sideboard, two floor tiles long: a dark walnut body, four doors with vertical light-oak slat fronts, slim black metal legs. The top is empty.'),
mobileWhiteboard: job([1.3, 0.5, 1.8], FRONT, 'A mobile whiteboard on wheels: a white rectangular board in a slim black metal frame on two legs with caster wheels, a marker tray under the board; on the board, colorful marker sketches: boxes joined by arrows, a small bar chart and three sticky notes (yellow, pink, teal). No letters and no words anywhere.'),
eggChair: job([1, 1, 1.9], FRONT, 'A hanging egg chair: a rounded egg-shaped seat woven from natural rattan wicker with a wide opening at its front, a plump cream cushion inside, hanging by a short chain from a tall curved black metal stand on a round black base.'),

  // ---------- plants ----------
planter: job([2, 0.45, 0.85], FRONT, 'A long low planter box used as a room divider in a modern office, two floor tiles long and narrow: a honey-oak wooden trough on slim black metal legs, overflowing with lush green plants (upright snake plants, leafy ferns, trailing pothos vines over the front edge).'),
'plant-tall': job([0.6, 0.6, 1.8], ROUND, 'A tall indoor plant in a round white ceramic pot: a fiddle-leaf fig with big glossy green leaves on a thin trunk.'),
'plant-bush': job([0.8, 0.8, 1], ROUND, 'A bushy indoor plant in a round terracotta pot: a full rounded mass of small green leaves.'),
'plant-fern': job([0.7, 0.7, 0.9], ROUND, 'A leafy fern in a round charcoal pot: long arching green fronds spilling outward.'),
'plant-flower': job([0.45, 0.45, 0.6], ROUND, 'A small flowering plant in a round white pot: green leaves with coral and mustard-yellow blossoms.'),
'plant-cactus': job([0.4, 0.4, 0.6], ROUND, 'A small cactus in a round terracotta pot: one rounded green column with two arms and tiny white spines.'),
}
