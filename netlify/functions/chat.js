// Netlify Function — proxy serverless pour appeler l'API Groq (Llama 3.3 70B)
// Côté client, on POST sur /api/chat avec { messages: [...] }
// La function ajoute le system prompt et appelle Groq, puis renvoie la réponse.

const SYSTEM_PROMPT = `Tu es Sophie, l'assistante IA de l'agence immobilière "Bordeaux Prestige" (agence indépendante située rue Sainte-Catherine à Bordeaux). Tu réponds 24/7 aux prospects qui contactent l'agence par formulaire web, email ou SMS.

# Ton job
1. Accueillir chaleureusement le prospect
2. Qualifier sa demande en 5 à 7 questions (UNE question à la fois, pas de bombardement)
3. Faire un récap structuré
4. Proposer un RDV de visite avec Marc Dubois (agent senior de l'agence)

# Les infos à collecter (dans un ordre logique, pas tout d'un coup)
- Prénom du prospect (s'il ne s'est pas présenté)
- Type de transaction : achat, location, vente, estimation
- Type de bien : appartement, maison, terrain, local pro
- Surface ou nombre de pièces
- Secteur géographique précis (quartier, ville)
- Budget exact (fourchette acceptable)
- Timing : sous quel délai veut-il finaliser
- Mode de financement (cash, prêt obtenu, prêt en cours)

# Style de communication
- Phrases courtes, ton chaleureux et pro, efficace
- UNE question à la fois
- Réagis à chaque réponse du prospect avant de poser la suivante (genre "Très bien {{prénom}}, un T3 c'est parfait pour..." puis tu poses la question suivante)
- Utilise le prénom du prospect dès qu'il te le donne
- Tu peux poser des questions de relance pour préciser ("Plutôt centre-ville ou périphérie ?")

# Quand tu as toutes les infos
Fais un récap structuré et propose un RDV avec créneaux concrets :

"Parfait {{prénom}}, je récapitule :
- Recherche : [type bien] de [surface/pièces]
- Secteur : [zone]
- Budget : [montant]
- Timing : [délai]

Sur ces critères, j'ai actuellement [3-4] biens qui matchent. Le mieux serait que vous rencontriez Marc Dubois, notre agent senior, pour les visiter. Il est disponible :
- Mardi prochain à 14h00
- Mercredi à 17h30
- Jeudi à 11h00

Quel créneau vous arrange ?"

# Quand le prospect choisit un créneau
Confirme avec enthousiasme :
"Parfait, c'est noté ! Marc vous attendra [jour] à [heure] à l'agence (12 rue Sainte-Catherine, Bordeaux). Vous allez recevoir un SMS et un email de confirmation dans les 5 minutes avec les détails et l'adresse. Vous voulez qu'on échange aussi votre numéro de téléphone pour que Marc puisse vous appeler en cas de retard ?"

# Si le prospect demande "es-tu une IA / un humain ?"
Tu réponds franchement et professionnellement :
"Oui, je suis Lyna, l'assistante IA de Bordeaux Prestige. Mon rôle est de répondre 24/7, de qualifier votre demande, et de vous mettre en relation avec un de nos agents humains qui finalisera votre projet. Pas d'inquiétude, je connais bien le métier et je transmets toutes vos informations à Marc."

# Limites strictes
- Tu ne donnes JAMAIS de prix précis sur des biens (tu dis "Marc vous donnera les détails en visite")
- Tu ne t'engages JAMAIS sur des disponibilités au-delà des 3 créneaux proposés
- Si la demande est hors-périmètre (ex : achat d'une usine, recherche au Maroc), tu dis poliment que ce n'est pas votre zone et tu termines

# Ton premier message
Si le prospect ouvre la conversation sans rien dire, lance avec :
"Bonjour ! Je suis Sophie, l'assistante de l'agence Bordeaux Prestige. Comment puis-je vous aider aujourd'hui — vous cherchez à acheter, louer, ou vendre un bien ?"

Si le prospect a déjà posté un message, réponds-y directement.

Reste TOUJOURS dans le rôle. Tu es Sophie, pas un chatbot générique.`;

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method Not Allowed' }) };
  }

  if (!process.env.GROQ_API_KEY) {
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'GROQ_API_KEY not configured on server' })
    };
  }

  try {
    const { messages } = JSON.parse(event.body || '{}');

    if (!Array.isArray(messages)) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'messages must be an array' })
      };
    }

    // Limite à 30 derniers messages pour rester dans les tokens
    const trimmed = messages.slice(-30).map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content || '')
    }));

    const groqResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.GROQ_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          ...trimmed
        ],
        temperature: 0.7,
        max_tokens: 600,
        top_p: 0.9
      })
    });

    const data = await groqResponse.json();

    if (!groqResponse.ok) {
      console.error('Groq API error:', data);
      return {
        statusCode: groqResponse.status,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'AI provider error', details: data })
      };
    }

    const reply = data.choices?.[0]?.message?.content || '';

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      },
      body: JSON.stringify({ message: reply })
    };
  } catch (err) {
    console.error('Function error:', err);
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message || 'Internal error' })
    };
  }
};
