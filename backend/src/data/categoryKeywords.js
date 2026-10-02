// What A-Read knows about common book categories, used to work out a book's category from its
// own words. `aliases` are category names (English and Swahili) an admin might use; `terms` are
// words and two-word phrases typical of such books. `style` adds a signal from how the text is
// written: 'story' (a lot of dialogue), 'verse' (short lines) or 'play'. Words are compared after
// lower-casing and turning plurals into singulars, so "Novels" and "novel" match.
export const CATEGORY_DICTIONARY = [
  {
    name: 'Fiction',
    aliases: ['fiction', 'novels', 'novel', 'stories', 'short stories', 'literature', 'fasihi', 'riwaya', 'hadithi'],
    style: 'story',
    terms: [
      'novel', 'said', 'replied', 'whispered', 'cried', 'smiled', 'laughed', 'nodded', 'sighed', 'shouted',
      'muttered', 'exclaimed', 'stared', 'glanced', 'frowned', 'grinned', 'murmured', 'shrugged', 'gasped',
      'tale', 'heroine', 'hero', 'adventure', 'village', 'stranger', 'darkness', 'silence', 'door', 'eyes',
    ],
  },
  {
    name: 'Romance',
    aliases: ['romance', 'love stories', 'love story', 'mapenzi'],
    style: 'story',
    terms: [
      'love', 'kiss', 'kissed', 'lover', 'romance', 'passion', 'beloved', 'darling', 'sweetheart', 'embrace',
      'wedding', 'bride', 'courtship', 'engaged', 'marry', 'heartbeat', 'desire', 'jealous', 'tender', 'affection',
    ],
  },
  {
    name: 'Mystery & Crime',
    aliases: ['mystery', 'mysteries', 'crime', 'thriller', 'thrillers', 'detective', 'suspense', 'upelelezi'],
    style: 'story',
    terms: [
      'detective', 'murder', 'murderer', 'inspector', 'police', 'crime', 'criminal', 'clue', 'suspect', 'killer',
      'victim', 'evidence', 'investigation', 'mystery', 'corpse', 'alibi', 'poison', 'robbery', 'constable',
      'scotland yard', 'witness', 'motive', 'confession', 'blackmail', 'kidnap', 'gun', 'revolver', 'stolen',
    ],
  },
  {
    name: 'Fantasy & Science Fiction',
    aliases: ['fantasy', 'science fiction', 'sci fi', 'scifi', 'speculative fiction'],
    style: 'story',
    terms: [
      'magic', 'wizard', 'dragon', 'spell', 'sorcerer', 'witch', 'quest', 'sword', 'elf', 'dwarf', 'goblin',
      'fairy', 'enchanted', 'prophecy', 'realm', 'spaceship', 'planet', 'alien', 'robot', 'galaxy', 'starship',
      'time machine', 'martian', 'laser', 'android', 'portal', 'potion', 'kingdom',
    ],
  },
  {
    name: 'Children',
    aliases: ['children', 'kids', 'children s books', 'picture books', 'young readers', 'watoto'],
    style: 'story',
    terms: [
      'once upon a time', 'little', 'rabbit', 'bunny', 'bear', 'puppy', 'kitten', 'mommy', 'daddy', 'toy',
      'play', 'fairy tale', 'alphabet', 'bedtime', 'princess', 'giant', 'friend', 'tortoise', 'hare', 'monkey',
      'lion', 'elephant', 'teddy', 'grandma', 'granny',
    ],
  },
  {
    name: 'Poetry',
    aliases: ['poetry', 'poems', 'poem', 'verse', 'mashairi', 'ushairi'],
    style: 'verse',
    terms: [
      'poem', 'poet', 'poetry', 'verse', 'stanza', 'sonnet', 'rhyme', 'ode', 'ballad', 'lyric', 'elegy', 'haiku',
      'couplet', 'thee', 'thou', 'thy', 'thine', 'o er', 'shairi', 'beti',
    ],
  },
  {
    name: 'Drama & Plays',
    aliases: ['drama', 'plays', 'play', 'theatre', 'theater', 'tamthilia'],
    style: 'play',
    terms: [
      'act', 'scene', 'enter', 'exit', 'exeunt', 'stage', 'actor', 'curtain', 'playwright', 'chorus', 'aside',
      'dramatis personae', 'enter king', 'act i', 'scene i', 'tragedy', 'comedy',
    ],
  },
  {
    name: 'History',
    aliases: ['history', 'historical', 'historia'],
    terms: [
      'history', 'historian', 'historical', 'century', 'empire', 'war', 'battle', 'dynasty', 'colonial', 'colony',
      'revolution', 'ancient', 'medieval', 'independence', 'treaty', 'army', 'conquest', 'civilization',
      'archaeology', 'era', 'reign', 'invasion', 'rebellion', 'world war', 'mau mau', 'slavery', 'emperor',
      'pharaoh', 'roman', 'monarchy', 'kingdom', 'crusade', 'missionary', 'protectorate', 'uprising',
    ],
  },
  {
    name: 'Biography & Memoir',
    aliases: ['biography', 'biographies', 'autobiography', 'memoir', 'memoirs', 'life stories', 'wasifu', 'tawasifu'],
    terms: [
      'biography', 'autobiography', 'memoir', 'born', 'childhood', 'boyhood', 'girlhood', 'career', 'early life',
      'my life', 'my father', 'my mother', 'recollection', 'diary', 'letters', 'youth', 'later life', 'died',
      'grew up', 'my childhood',
    ],
  },
  {
    name: 'Religion & Spirituality',
    aliases: ['religion', 'religious', 'spirituality', 'spiritual', 'faith', 'christianity', 'christian', 'islam', 'islamic', 'theology', 'dini', 'imani'],
    terms: [
      'god', 'lord', 'jesus', 'christ', 'bible', 'scripture', 'gospel', 'prayer', 'pray', 'church', 'faith', 'holy',
      'spirit', 'salvation', 'sin', 'heaven', 'prophet', 'allah', 'quran', 'mosque', 'muslim', 'psalm', 'apostle',
      'sermon', 'worship', 'theology', 'divine', 'grace', 'blessed', 'mungu', 'yesu', 'biblia', 'sala', 'kanisa',
      'msikiti', 'imani', 'roho', 'old testament', 'new testament',
    ],
  },
  {
    name: 'Philosophy',
    aliases: ['philosophy', 'philosophical', 'falsafa'],
    terms: [
      'philosophy', 'philosopher', 'ethics', 'ethical', 'morality', 'moral', 'reason', 'truth', 'knowledge',
      'existence', 'metaphysics', 'logic', 'virtue', 'soul', 'consciousness', 'socrates', 'plato', 'aristotle',
      'kant', 'wisdom', 'epistemology', 'stoic', 'nature of', 'human nature', 'free will', 'justice',
    ],
  },
  {
    name: 'Science & Nature',
    aliases: ['science', 'sciences', 'nature', 'natural history', 'physics', 'chemistry', 'biology', 'environment', 'sayansi'],
    terms: [
      'science', 'scientific', 'scientist', 'experiment', 'theory', 'physics', 'chemistry', 'biology', 'cell',
      'atom', 'molecule', 'energy', 'evolution', 'species', 'organism', 'gene', 'dna', 'laboratory', 'hypothesis',
      'astronomy', 'ecology', 'climate', 'environment', 'wildlife', 'fossil', 'bacteria', 'electron', 'gravity',
      'element', 'chemical', 'specimen', 'habitat', 'ecosystem', 'mammal', 'insect',
    ],
  },
  {
    name: 'Mathematics',
    aliases: ['mathematics', 'maths', 'math', 'hisabati'],
    terms: [
      'equation', 'theorem', 'proof', 'algebra', 'geometry', 'calculus', 'integer', 'fraction', 'matrix',
      'probability', 'statistics', 'triangle', 'angle', 'formula', 'variable', 'derivative', 'integral',
      'polynomial', 'prime', 'arithmetic', 'decimal', 'quadratic', 'logarithm', 'vector',
    ],
  },
  {
    name: 'Technology & Computing',
    aliases: ['technology', 'computing', 'computers', 'computer science', 'programming', 'it', 'ict', 'teknolojia', 'kompyuta'],
    terms: [
      'computer', 'software', 'programming', 'code', 'algorithm', 'data', 'database', 'internet', 'network', 'web',
      'digital', 'app', 'javascript', 'python', 'java', 'server', 'cloud', 'machine learning', 'artificial intelligence',
      'technology', 'device', 'mobile', 'cyber', 'linux', 'html', 'developer', 'function', 'byte', 'website',
      'smartphone', 'online',
    ],
  },
  {
    name: 'Business & Finance',
    aliases: ['business', 'finance', 'economics', 'money', 'entrepreneurship', 'management', 'biashara', 'uchumi', 'fedha'],
    terms: [
      'business', 'money', 'market', 'marketing', 'profit', 'investment', 'investor', 'finance', 'financial', 'bank',
      'loan', 'capital', 'economy', 'economic', 'entrepreneur', 'startup', 'customer', 'sales', 'management', 'company',
      'strategy', 'budget', 'tax', 'accounting', 'income', 'wealth', 'stock', 'trade', 'revenue', 'saving', 'debt',
      'biashara', 'pesa', 'mkopo', 'soko', 'mtaji', 'faida',
    ],
  },
  {
    name: 'Self-help',
    aliases: ['self help', 'personal development', 'personal growth', 'motivation', 'motivational', 'inspiration', 'inspirational'],
    terms: [
      'success', 'habit', 'goal', 'motivation', 'mindset', 'confidence', 'happiness', 'productivity', 'purpose',
      'potential', 'achieve', 'dream', 'positive', 'discipline', 'attitude', 'self esteem', 'personal growth',
      'your life', 'you can', 'believe in yourself', 'gratitude', 'resilience',
    ],
  },
  {
    name: 'Health & Medicine',
    aliases: ['health', 'medicine', 'medical', 'wellness', 'fitness', 'nutrition', 'afya'],
    terms: [
      'health', 'healthy', 'disease', 'doctor', 'patient', 'medicine', 'medical', 'treatment', 'symptom', 'diet',
      'nutrition', 'exercise', 'fitness', 'hospital', 'infection', 'virus', 'cancer', 'diabetes', 'blood', 'therapy',
      'mental health', 'pregnancy', 'vaccine', 'nurse', 'vitamin', 'immune', 'afya', 'ugonjwa', 'daktari', 'hospitali',
      'dawa',
    ],
  },
  {
    name: 'Education & Study',
    aliases: ['education', 'textbooks', 'textbook', 'study guides', 'revision', 'school', 'elimu', 'kcse', 'kcpe'],
    terms: [
      'student', 'teacher', 'lesson', 'exam', 'examination', 'revision', 'syllabus', 'curriculum', 'learner', 'learning',
      'education', 'exercise', 'topic', 'kcse', 'kcpe', 'cbc', 'grade', 'university', 'college', 'answer', 'question',
      'marking scheme', 'past paper', 'elimu', 'mwalimu', 'mwanafunzi', 'mtihani', 'zoezi', 'somo',
    ],
  },
  {
    name: 'Politics & Law',
    aliases: ['politics', 'political', 'law', 'legal', 'government', 'current affairs', 'siasa', 'sheria'],
    terms: [
      'government', 'politics', 'political', 'policy', 'election', 'vote', 'democracy', 'parliament', 'president',
      'constitution', 'law', 'legal', 'court', 'judge', 'justice', 'rights', 'citizen', 'minister', 'governance',
      'corruption', 'legislation', 'statute', 'tribunal', 'siasa', 'serikali', 'katiba', 'sheria', 'uchaguzi', 'bunge',
    ],
  },
  {
    name: 'Agriculture & Farming',
    aliases: ['agriculture', 'farming', 'agribusiness', 'kilimo'],
    terms: [
      'farm', 'farming', 'farmer', 'crop', 'soil', 'harvest', 'seed', 'maize', 'livestock', 'cattle', 'dairy',
      'poultry', 'irrigation', 'fertilizer', 'manure', 'yield', 'agriculture', 'coffee', 'pest', 'goat', 'acre',
      'planting', 'greenhouse', 'kilimo', 'mkulima', 'shamba', 'mbegu', 'mavuno', 'mifugo',
    ],
  },
  {
    name: 'Cooking & Food',
    aliases: ['cooking', 'cookery', 'food', 'recipes', 'cookbook', 'cookbooks', 'mapishi'],
    terms: [
      'recipe', 'cook', 'cooking', 'kitchen', 'ingredient', 'tablespoon', 'teaspoon', 'bake', 'oven', 'flour',
      'sugar', 'butter', 'onion', 'garlic', 'boil', 'fry', 'meal', 'sauce', 'serve', 'minute', 'stir', 'pinch',
      'mapishi', 'unga', 'chumvi', 'kitunguu',
    ],
  },
  {
    name: 'Travel & Geography',
    aliases: ['travel', 'geography', 'travel guides', 'safari', 'jiografia'],
    terms: [
      'travel', 'journey', 'trip', 'tourist', 'tour', 'country', 'map', 'mountain', 'river', 'lake', 'ocean', 'coast',
      'island', 'safari', 'hotel', 'explore', 'explorer', 'geography', 'continent', 'landscape', 'border', 'region',
      'latitude', 'expedition', 'traveller', 'traveler',
    ],
  },
  {
    name: 'Arts, Music & Culture',
    aliases: ['arts', 'art', 'music', 'culture', 'design', 'photography', 'sanaa', 'muziki', 'utamaduni'],
    terms: [
      'art', 'artist', 'painting', 'painter', 'music', 'musician', 'song', 'dance', 'culture', 'tradition', 'design',
      'photography', 'film', 'museum', 'gallery', 'sculpture', 'melody', 'rhythm', 'instrument', 'canvas', 'sanaa',
      'wimbo', 'ngoma', 'utamaduni', 'mila',
    ],
  },
  {
    name: 'Sports',
    aliases: ['sports', 'sport', 'athletics', 'football', 'michezo'],
    terms: [
      'sport', 'football', 'soccer', 'athlete', 'athletics', 'team', 'match', 'player', 'coach', 'championship',
      'olympic', 'race', 'runner', 'marathon', 'training', 'league', 'tournament', 'score', 'cricket', 'rugby',
      'tennis', 'basketball', 'stadium', 'medal', 'michezo', 'mpira',
    ],
  },
  {
    name: 'Language & Reference',
    aliases: ['language', 'languages', 'dictionary', 'reference', 'grammar', 'lugha', 'kamusi', 'kiswahili', 'english'],
    terms: [
      'grammar', 'vocabulary', 'sentence', 'verb', 'noun', 'adjective', 'adverb', 'pronunciation', 'dictionary',
      'language', 'translation', 'phrase', 'spelling', 'tense', 'idiom', 'proverb', 'synonym', 'methali', 'sarufi',
      'msamiati', 'kamusi', 'lugha', 'nahau', 'kitenzi', 'nomino',
    ],
  },
];

// Words that say nothing about a book's subject (English and Swahili), plus words every book has.
export const STOPWORDS = new Set(
  `a about above after again against all also am an and any are aren as at be because been before being below
  between both but by can cannot could did do does doing down during each few for from further had has have having
  he her here hers herself him himself his how i if in into is it its itself just let me more most my myself no nor
  not now of off on once only or other ought our ours ourselves out over own same she should so some such than that
  the their theirs them themselves then there these they this those through to too under until up upon very was we
  were what when where which while who whom why will with would you your yours yourself yourselves one two three
  first second new may might must shall us yet still even much many every other another however thus therefore
  though although whether within without whose
  chapter book page part contents introduction preface foreword edition copyright author published publisher
  isbn rights reserved printed gutenberg ebook www http https com org
  na ya wa kwa la za ni katika hii huo yake yao kama lakini au pia sana kuwa hiyo hilo hizo huyo yule ile kila
  wake wao wetu wangu yako yangu zake bila baada kabla hadi tena hata kwamba ambao ambayo ambaye ndiyo ndio
  si sisi wewe mimi yeye nyinyi wao hapo pale huku kule hivyo hivi`.split(/\s+/).filter(Boolean),
);

// Categories offered to admins who are just starting ("Add common categories").
export const STARTER_CATEGORIES = [
  'Fiction', 'Children', 'Poetry', 'History', 'Biography & Memoir', 'Religion & Spirituality',
  'Science & Nature', 'Technology & Computing', 'Business & Finance', 'Self-help', 'Health & Medicine',
  'Education & Study', 'Politics & Law', 'Agriculture & Farming', 'Cooking & Food',
];
