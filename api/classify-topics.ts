import type { VercelRequest, VercelResponse } from '@vercel/node';

const TOPIC_KEYWORDS: Record<string, string[]> = {
  water: ['water', 'irrigation', 'river', 'drought', 'dam', 'flood', 'rainfall', 'drinking water', 'reservoir', 'canal', 'groundwater', 'monsoon', 'rain', 'waterlogging', 'water supply', 'pipeline', 'borewell'],
  power: ['electricity', 'power cut', 'power outage', 'transformer', 'solar', 'energy', 'subsidy', 'tariff', 'grid', 'blackout', 'renewable', 'power plant', 'voltage', 'megawatt', 'electric'],
  farmers: ['farmer', 'crop', 'mandi', 'msp', 'fertilizer', 'agriculture', 'harvest', 'kisan', 'paddy', 'wheat', 'rice', 'sugarcane', 'tractor', 'irrigation', 'rural', 'farm', 'seed', 'pesticide', 'organic'],
  politics: ['election', 'minister', 'government', 'parliament', 'bjp', 'congress', 'policy', 'vote', 'chief minister', 'prime minister', 'opposition', 'assembly', 'cabinet', 'legislation', 'party', 'rally'],
  sports: ['cricket', 'ipl', 'football', 'match', 'tournament', 'medal', 'athlete', 'hockey', 'badminton', 'olympics', 'world cup', 'test match', 'player', 'team', 'stadium', 'score', 'wicket', 'goal'],
  economy: ['gdp', 'economy', 'market', 'stock', 'inflation', 'rupee', 'budget', 'tax', 'rbi', 'bank', 'loan', 'investment', 'export', 'import', 'trade', 'growth', 'recession', 'employment'],
  education: ['school', 'college', 'university', 'exam', 'student', 'teacher', 'education', 'syllabus', 'board', 'neet', 'jee', 'admission', 'scholarship', 'degree', 'curriculum'],
  health: ['hospital', 'doctor', 'health', 'disease', 'vaccine', 'covid', 'patient', 'medicine', 'surgery', 'clinic', 'medical', 'treatment', 'virus', 'pandemic', 'infection'],
};

function classifyTopic(englishText: string): string | null {
  const lower = englishText.toLowerCase();
  let bestTopic: string | null = null;
  let bestScore = 0;

  for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
    let score = 0;
    for (const keyword of keywords) {
      if (lower.includes(keyword)) {
        score += keyword.includes(' ') ? 2 : 1;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestTopic = topic;
    }
  }

  return bestScore >= 1 ? bestTopic : null;
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { headlines } = req.body;
    if (!Array.isArray(headlines)) {
      return res.status(400).json({ error: 'Missing headlines array' });
    }

    const classifications = headlines.map((h: { id: string; englishText: string }) => ({
      id: h.id,
      topic: classifyTopic(h.englishText || ''),
    }));

    res.json({ classifications });
  } catch (err) {
    console.error('Classify error:', err);
    res.status(500).json({ error: (err as Error).message });
  }
}
