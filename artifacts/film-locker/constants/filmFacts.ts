/**
 * Film facts, for the wait while a film is being identified.
 *
 * A hundred of them, chosen to be readable in the few seconds a card is on
 * screen: one sentence, no setup, no punchline that depends on the one
 * before it. They are drawn from film history, craft and production rather
 * than box-office numbers, which date badly and are duller to read.
 *
 * Deliberately excluded: the well-travelled anecdotes that turn out not to
 * be true. There is no hanged extra in The Wizard of Oz and no record of
 * Chaplin losing a Chaplin lookalike contest, however often both are
 * repeated. Anything added here should be documented rather than merely
 * widespread — a loading screen that teaches people folklore is worse than
 * one that says nothing.
 */
export const FILM_FACTS: readonly string[] = [
  // ── Beginnings ──────────────────────────────────────────────────────────
  'The Lumière brothers held the first paying public film screening in Paris in December 1895.',
  'Roundhay Garden Scene, filmed in Leeds in 1888, is among the oldest surviving films in existence.',
  'Georges Méliès made A Trip to the Moon in 1902, and it is still cited as the first science-fiction film.',
  'The Jazz Singer (1927) brought synchronised dialogue to a mass audience and hastened the end of silent cinema.',
  'Silent films were shot and projected at varying speeds, which is why old footage can look comically fast today.',
  'Frame rate only settled at 24 per second because sound-on-film needed a constant speed.',
  'A large share of American silent features no longer survive in any form — the nitrate they were printed on decayed or burned.',
  'Nosferatu (1922) was an unauthorised Dracula, and a court ordered every copy destroyed. Some survived anyway.',
  'Snow White and the Seven Dwarfs (1937) was the first feature-length cel-animated film.',
  'Walt Disney was given an honorary Oscar for Snow White: one full-size statuette and seven miniature ones.',

  // ── Craft and technique ─────────────────────────────────────────────────
  'The dolly zoom — pulling the camera back while zooming in — is also called the Vertigo effect, after the Hitchcock film.',
  'The Steadicam was invented by Garrett Brown in the 1970s, and Rocky’s run up the Philadelphia steps was one of its first outings.',
  'Kubrick used the then-new Steadicam throughout The Shining to glide along the Overlook’s corridors.',
  '2001: A Space Odyssey created its prehistoric landscapes with front projection rather than painted backdrops.',
  'Hitchcock built Rope out of long takes disguised to look like one unbroken shot.',
  'Russian Ark (2002) really is a single continuous take, running over 90 minutes.',
  'Birdman and 1917 were both designed to look like one shot, stitched together from many.',
  'The Matrix created bullet time with a ring of still cameras fired in sequence rather than a single moving one.',
  '"Day for night" is the trick of shooting in daylight and grading it down to look like darkness.',
  'Green replaced blue as the standard matte colour partly because digital sensors are most sensitive to it.',
  'The clapperboard exists to give editors a single frame and a single sound that obviously belong together.',
  'ADR — re-recording dialogue in a studio after filming — is why some lines sound subtly cleaner than others.',
  'Foley artists, who create footsteps and rustles by hand in a studio, are named after Jack Foley.',
  'The Academy ratio, roughly four units wide to three tall, was Hollywood’s standard shape for decades.',
  'CinemaScope and other wide formats were pushed in the 1950s to offer something television could not.',
  'Cinerama ran three projectors at once onto a deeply curved screen.',
  'Three-strip Technicolor needed a camera so large and loud it was rented out with its own technician.',
  'Black Narcissus and The Red Shoes are still held up as the high-water mark of Technicolor photography.',
  'The Wizard of Oz shifts from sepia to full colour at the moment Dorothy steps into Oz.',
  'Singin’ in the Rain had milk mixed into the rain so the water would read on camera.',

  // ── Sound ───────────────────────────────────────────────────────────────
  'Darth Vader’s breathing is a scuba regulator, recorded by sound designer Ben Burtt.',
  'The lightsaber hum began as the idling motor of a film projector, mixed with interference from a television set.',
  'The Wilhelm scream is a single stock recording from 1951, quietly reused in hundreds of films since.',
  'Jurassic Park’s raptors speak in sounds including tortoises mating, geese and horses.',
  'THX’s Deep Note was not played but computed, by a program James Moorer wrote for the purpose.',
  'Ennio Morricone’s theme for The Good, the Bad and the Ugly imitates the howl of a coyote.',
  'The MGM lion has been played by a succession of different lions over the decades.',
  'Walter Murch was the first person credited as a film’s sound designer, on Apocalypse Now.',

  // ── On set ──────────────────────────────────────────────────────────────
  'Jaws’ mechanical sharks broke down so often that Spielberg suggested the shark instead of showing it.',
  '"You’re gonna need a bigger boat" was improvised by Roy Scheider on the set of Jaws.',
  '"Here’s Johnny!" was Jack Nicholson’s improvisation, borrowed from The Tonight Show.',
  'The cat Marlon Brando strokes in The Godfather’s first scene was a stray he found on the studio lot.',
  'The cast of Alien were kept in the dark about quite how much blood the chestburster scene involved.',
  'The ripples in the water glass in Jurassic Park were made by plucking a guitar string fixed under the dashboard.',
  'Psycho used chocolate syrup for blood, because it read better than the real thing in black and white.',
  'Psycho was among the first mainstream American films to show a toilet being flushed.',
  'The shower scene in Psycho took about a week to shoot and lasts roughly three minutes.',
  'Buster Keaton stood still while a house front weighing around two tons fell around him in Steamboat Bill, Jr.',
  'Harold Lloyd dangled from that clock face having lost a thumb and forefinger to a prop bomb years earlier, hidden by a prosthetic glove.',
  'Casablanca was shot while its script was still being written, and the cast did not know how it would end.',
  'Eric Stoltz played Marty McFly for weeks before being replaced by Michael J. Fox.',
  'Michael J. Fox shot Back to the Future at night while making Family Ties during the day.',
  'The DeLorean was chosen for Back to the Future partly because its doors made it plausible as a spacecraft.',
  'E.T. ate Reese’s Pieces because the makers of M&M’s turned the film down.',
  'Harrison Ford was doing carpentry work at the studio when he read lines opposite other actors’ auditions.',
  'The Star Wars opening crawl was a physical model, filmed by moving a camera over printed text.',
  'Mad Max: Fury Road was built mainly from real vehicles and real stunts, with effects used to remove the rigging.',
  'Titanic’s near-full-size ship was built on the coast of Mexico and lowered into a purpose-built tank.',
  'Peter Jackson’s hobbits were shrunk with forced perspective, oversized props and doubles of different heights.',
  'The Lord of the Rings trilogy was shot in one continuous stretch in New Zealand, all three films at once.',
  'Gollum was built on Andy Serkis’s performance, captured on set alongside the other actors.',
  'Gravity lit its actors from inside a box of LED panels showing the image they were supposed to be reflecting.',
  'Avatar’s performance capture used cameras mounted on headsets a few inches from each actor’s face.',
  'The Lion King’s wildebeest stampede was computer-generated, and took animators years to build.',
  'Who Framed Roger Rabbit persuaded rival studios to let their characters appear in the same frame.',
  'Spider-Man: Into the Spider-Verse printed comic-book halftone dots over its computer animation on purpose.',

  // ── Awards ──────────────────────────────────────────────────────────────
  'The first Academy Awards ceremony, in 1929, was over in about fifteen minutes.',
  'Wings, a silent film about aerial combat, won the first Best Picture award.',
  'Hattie McDaniel was the first Black performer to win an Academy Award, for Gone with the Wind.',
  'Parasite was the first film not in English to win Best Picture.',
  'Spirited Away was the first film not in English to win Best Animated Feature.',
  'Ben-Hur, Titanic and The Lord of the Rings: The Return of the King have each won eleven Oscars.',
  'The Return of the King won every single category it was nominated in.',
  'Only three films have taken all five of the top Oscars: It Happened One Night, One Flew Over the Cuckoo’s Nest and The Silence of the Lambs.',
  'Anthony Hopkins is on screen for around sixteen minutes in The Silence of the Lambs, and won Best Actor for it.',
  'Beatrice Straight won an Oscar for Network on barely five minutes of screen time.',
  'Marlon Brando refused his Oscar for The Godfather in protest at how Hollywood portrayed Native Americans.',
  'Walt Disney won more Academy Awards than any other individual.',
  'Marcia Lucas shared the Oscar for editing Star Wars, a film substantially reshaped in the cutting room.',
  'Mad Max: Fury Road won six Oscars, every one of them in a craft category.',

  // ── Ideas and vocabulary ────────────────────────────────────────────────
  'A MacGuffin is Hitchcock’s word for the thing everyone in the film is chasing and the audience need not care about.',
  'The Kuleshov effect showed that an audience reads emotion into a face from whatever shot is placed beside it.',
  'Eisenstein built Battleship Potemkin’s Odessa Steps sequence to argue that meaning comes from collision between shots.',
  'Breathless made the jump cut respectable by using it constantly and unapologetically.',
  'The French New Wave was largely made by critics from Cahiers du cinéma who decided to pick up cameras.',
  'The Bechdel test asks only whether two named women speak to each other about something other than a man.',
  'Un Chien Andalou was made by Luis Buñuel and Salvador Dalí, who claimed to have built it from their dreams.',
  'Hitchcock appeared briefly in almost all of his own films, usually early, so the audience would stop looking.',

  // ── Business and the audience ───────────────────────────────────────────
  'The Hollywood sign originally read HOLLYWOODLAND and was an advertisement for property.',
  'The Hays Code governed what American films could show for decades before ratings replaced it.',
  'The PG-13 rating was created in 1984, after Indiana Jones and the Temple of Doom and Gremlins arrived rated PG.',
  'Smell-O-Vision was attempted exactly once, for Scent of Mystery in 1960.',
  'William Castle wired cinema seats with buzzers so audiences could feel The Tingler.',
  'The Blair Witch Project was marketed as though its footage had really been found.',
  'Titanic was the first film to take a billion dollars worldwide.',
  'Akira Kurosawa’s Seven Samurai became the Western The Magnificent Seven.',
  'Kurosawa’s Yojimbo became A Fistful of Dollars without permission, and his studio sued over it.',
  'Studio Ghibli is named after an Italian aircraft, which was itself named after a hot desert wind.',
  'Pixar hides the code A113 across its films, after a classroom at the art school several of its founders attended.',
  'Pixar’s desk lamp comes from Luxo Jr., a two-minute short from 1986.',
];

/**
 * A fresh order through all of them.
 *
 * Shuffled rather than taken in sequence from a random point: consecutive
 * facts here are grouped by subject, so walking forwards would show four
 * sound-design facts in a row to anyone unlucky enough to start there.
 */
export function shuffledFacts(): string[] {
  const out = [...FILM_FACTS];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
