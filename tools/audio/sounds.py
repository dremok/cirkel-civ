"""Every sound in the game: its ElevenLabs prompt and how it is processed.

Fields:
  bus       ui | sfx | amb | music (decides channel count, loudness target and folder)
  prompt    text sent to ElevenLabs
  dur       requested length in seconds (sound effects: 0.5..30; music: 3..600)
  n         how many candidates to generate
  influence prompt_influence for sound effects (0..1, higher follows the prompt more literally)
  tail      seconds kept after trimming (sound effects; the rest fades out), None = keep all
  loop      ambience loops: generated with loop=true and made seamless when processed
  mode      "hit" keeps only the loudest transient (for prompts that came back with several taps)
  hp, lp    high-pass / low-pass filter in Hz applied when processing

picks.json names the candidates that made it into the game.

The mood: restrained, warm, tactile, never cartoonish. Bad North, Townscaper, Dorfromantik.
"""

NO_VOICE = "No voices, no music."

SOUNDS = {
    # ---------------------------------------------------------------------------------- UI
    "ui_tap": dict(bus="ui", dur=0.5, n=4, influence=0.7, tail=0.25,
        prompt="A single very soft dry tap of a fingertip on a small smooth wooden block. Short, warm, muted, close, no reverb."),
    "ui_select": dict(bus="ui", dur=0.6, n=3, influence=0.7, tail=0.3, mode="hit",
        prompt="A small carved wooden game piece picked up and set down on a wooden board: one soft hollow tock. Close, warm, dry."),
    "ui_order": dict(bus="ui", dur=0.7, n=3, influence=0.6, tail=0.45,
        prompt="A quick soft stroke of a pencil marking thick paper, then a tiny wooden tap. Subtle, close, dry."),
    "ui_cancel": dict(bus="ui", dur=0.6, n=3, influence=0.6, tail=0.45,
        prompt="A soft short slide of thick paper drawn back across a wooden desk, gentle, close, dry."),
    "ui_confirm": dict(bus="ui", dur=2.0, n=3, influence=0.6, tail=1.8,
        prompt="A small brass hand bell struck once, very softly, warm and clear, gentle natural decay. Calm and intimate."),
    "ui_turn": dict(bus="ui", dur=3.0, n=3, influence=0.5, tail=2.8,
        prompt="A soft low wooden mallet strike on a hollow wooden log drum, once, warm and round, with a long gentle decay."),
    "ui_tick": dict(bus="ui", dur=0.5, n=3, influence=0.7, tail=0.15, mode="hit",
        prompt="One very quiet soft tick of an old wooden clock, dry and muted, close."),
    "ui_notify": dict(bus="ui", dur=1.2, n=3, influence=0.6, tail=1.1,
        prompt="Two soft rising notes on a small wooden marimba, gentle, warm, short."),
    "ui_page": dict(bus="ui", dur=0.8, n=3, influence=0.6, tail=0.6,
        prompt="A single soft page turn of thick paper in a quiet room, close, gentle."),

    # ------------------------------------------------------------------------------ Battle
    "march": dict(bus="sfx", dur=0.8, n=4, influence=0.5, tail=0.7,
        prompt="A small group of soldiers in leather boots take two or three steps on soft grass and earth, a light rattle of gear. Close. " + NO_VOICE),
    "hooves": dict(bus="sfx", dur=1.0, n=3, influence=0.5, tail=0.85,
        prompt="A horse trots three steps on soft earth, light jingle of tack. Close. " + NO_VOICE),
    "clash": dict(bus="sfx", dur=1.5, n=3, influence=0.5, tail=1.3,
        prompt="Two small groups of medieval soldiers collide: wooden shields bang together, two or three sword clangs, short. " + NO_VOICE),
    "hit": dict(bus="sfx", dur=0.7, n=4, influence=0.6, tail=0.55,
        prompt="A single sword strike on a wooden round shield: a solid thud with a metallic edge, short. " + NO_VOICE),
    "volley": dict(bus="sfx", dur=1.5, n=3, influence=0.5, tail=1.3,
        prompt="A volley of several arrows released from bows at once, bow strings twang and the arrows whoosh away. " + NO_VOICE),
    "thuds": dict(bus="sfx", dur=1.0, n=3, influence=0.5, tail=0.8,
        prompt="Several arrows land in quick succession, thudding into earth and a wooden shield. Short. " + NO_VOICE),
    "fall": dict(bus="sfx", dur=1.2, n=3, influence=0.5, tail=1.0,
        prompt="A soldier in leather and mail collapses onto grass: a soft heavy thud, a light rattle of gear, a wooden shield drops. " + NO_VOICE),
    "city_hit": dict(bus="sfx", dur=1.5, n=3, influence=0.5, tail=1.3,
        prompt="A heavy impact on an old stone wall, stones and timber crack, small debris crumbles down. Slightly distant. " + NO_VOICE),
    "capture": dict(bus="sfx", dur=3.5, n=3, influence=0.5, tail=3.3, lp=4500,
        prompt="A distant medieval war horn blows one long low note across a wide valley, natural echo."),
    "halt": dict(bus="sfx", dur=0.6, n=2, influence=0.5, tail=0.45,
        prompt="A soldier stops abruptly, boots scuff on gravel, gear settles with a short rattle. " + NO_VOICE),
    "muster": dict(bus="sfx", dur=1.5, n=3, influence=0.5, tail=1.3,
        prompt="A short soft roll on a frame drum ending on one round hit, with the rustle of armour as a soldier stands ready. " + NO_VOICE),

    # ----------------------------------------------------------------------------- Economy
    "found": dict(bus="sfx", dur=2.5, n=3, influence=0.5, tail=2.3,
        prompt="A new village is founded outdoors: a few hammer blows on timber, then small bright bells ring softly, gentle and joyful. No voices."),
    "built": dict(bus="sfx", dur=1.5, n=3, influence=0.5, tail=1.3,
        prompt="Heavy stone blocks set into place, a final mallet tap on stone, a satisfying settle, outdoors. " + NO_VOICE),
    "grow": dict(bus="sfx", dur=2.0, n=3, influence=0.5, tail=1.8,
        prompt="Soft warm hollow bamboo wind chimes clatter gently in a light breeze, then settle. Calm and pleasant. " + NO_VOICE),
    "fail": dict(bus="sfx", dur=0.6, n=2, influence=0.6, tail=0.45,
        prompt="A dull muted wooden thunk, a wooden stake failing to go into hard ground. Short. " + NO_VOICE),

    # ---------------------------------------------------------------------------- Ambience
    "amb_sea": dict(bus="amb", dur=30, n=2, influence=0.4, loop=True, hp=40, lp=9000,
        prompt="Gentle calm sea waves lapping on a sandy shore, soft distant surf, peaceful and continuous. No music, no voices."),
    "amb_meadow": dict(bus="amb", dur=30, n=2, influence=0.4, loop=True, hp=140,
        prompt="Birdsong over a summer meadow: a skylark high above, a few small songbirds nearby, a soft breeze through tall grass, peaceful Scandinavian countryside in the afternoon. Continuous. No music, no voices."),
    "amb_town": dict(bus="amb", dur=30, n=2, influence=0.4, loop=True, hp=60,
        prompt="A calm small medieval market town heard from a short distance: soft murmur of people, a blacksmith hammer now and then, a cart rolling by, chickens, birds. Peaceful, continuous. No music."),

    # ------------------------------------------------------------------------------- Music
    "music_planning": dict(bus="music", dur=150, n=1, prompt=(
        "Calm, contemplative instrumental for a beautiful indie strategy game about a small hand-crafted world. "
        "Felt piano with a sparse, tender melody, soft sustained strings, an occasional harp arpeggio and a warm "
        "nyckelharpa line. Gently Nordic folk harmony, D dorian. Slow, around 66 bpm, spacious, lots of air and "
        "silence between phrases. No drums, no percussion, no vocals, no choir. Intimate and unhurried, like the "
        "soundtracks of Dorfromantik or Townscaper. Starts softly and ends softly.")),
    "music_battle": dict(bus="music", dur=120, n=1, prompt=(
        "Restrained, slightly tense instrumental for a beautiful indie strategy game, armies moving across a small "
        "hand-crafted world. A low frame drum pulse like a slow heartbeat, plucked strings ostinato, cello and a "
        "nyckelharpa melody, minor key, around 88 bpm. Focused and elegant, never epic: no brass, no choir, no "
        "trailer hits, no vocals. Nordic folk colour. Starts softly and ends softly.")),
    "music_city": dict(bus="music", dur=120, n=1, prompt=(
        "Warm, gentle, pastoral instrumental for a cosy town-building view in an indie strategy game. Harp, soft "
        "wooden flute, nyckelharpa and pizzicato strings, a little light hand percussion, a calm folk dance feel, "
        "major key, around 84 bpm. Sunny afternoon, content and kind. No vocals. Starts softly and ends softly.")),
    "sting_victory": dict(bus="music", dur=9, n=2, prompt=(
        "A short, gentle, triumphant musical phrase: harp glissando into a warm swell of strings and a soft french "
        "horn, resolving on a bright major chord that rings out. Elegant, not bombastic. No vocals, no drums.")),
    "sting_defeat": dict(bus="music", dur=9, n=2, prompt=(
        "A short melancholic musical phrase: a solo cello over soft low piano chords, minor key, descending, fading "
        "into silence. Quiet and dignified. No vocals, no drums.")),
}
