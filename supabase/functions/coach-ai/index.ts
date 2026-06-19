import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SUPABASE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY') || '';
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') || '';
const CACHE_HOURS = 4;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};

interface StudentSummary {
  total: number;
  active_today: number;
  overdue_count: number;
  overdue_value: number;
  upcoming_payments: number;
  busiest_day: string;
  empty_days: string[];
  recent_absent: number;
  monthly_revenue: number;
  monthly_goal: number;
}

function buildPrompt(s: StudentSummary): string {
  return `Você é um consultor de negócio especializado em personal trainers brasileiros.
Analise os dados deste personal trainer e dê 3 a 5 insights práticos e acionáveis.

DADOS DO PERSONAL:
- Total de alunos ativos: ${s.total}
- Treinam hoje: ${s.active_today}
- Pagamentos vencidos: ${s.overdue_count} (R$${s.overdue_value})
- Pagamentos a vencer próximos: ${s.upcoming_payments}
- Dia mais cheio: ${s.busiest_day}
- Dias úteis sem treinos: ${s.empty_days.join(', ') || 'nenhum'}
- Faltas recentes: ${s.recent_absent}
- Receita do mês: R$${s.monthly_revenue}
- Meta do mês: R$${s.monthly_goal}

Para cada insight retorne JSON com:
{ "icon": "emoji", "title": "titulo curto", "desc": "ação concreta em 1 frase", "color": "var(--accent)" | "var(--green)" | "var(--orange)" | "var(--yellow)" | "#5b8cff", "priority": 1-3 }

Responda APENAS um array JSON válido com 3 a 5 objetos. Sem texto antes ou depois.
Tom: direto, brasileiro informal, foco em ação. Nunca repita insights óbvios já mostrados no app.`;
}

async function callGemini(prompt: string): Promise<any[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 1024 }
    })
  });
  if (!res.ok) throw new Error('Gemini error: ' + res.status);
  const json = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
  const cleaned = text.replace(/```json\s*|```/g, '').trim();
  return JSON.parse(cleaned);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { user_id, summary } = await req.json();
    if (!user_id || !summary) {
      return new Response(JSON.stringify({ error: 'missing user_id or summary' }), { status: 400, headers: corsHeaders });
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

    // Cache hit?
    const { data: cached } = await sb
      .from('coach_ai_cache')
      .select('insights, created_at')
      .eq('user_id', user_id)
      .maybeSingle();

    if (cached) {
      const age = (Date.now() - new Date(cached.created_at).getTime()) / 3600000;
      if (age < CACHE_HOURS) {
        return new Response(JSON.stringify({ insights: cached.insights, cached: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // Gera novo
    if (!GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: 'gemini_key_missing', insights: [] }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const insights = await callGemini(buildPrompt(summary));

    // Salva cache
    await sb.from('coach_ai_cache').upsert({
      user_id,
      insights,
      created_at: new Date().toISOString()
    }, { onConflict: 'user_id' });

    return new Response(JSON.stringify({ insights, cached: false }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e), insights: [] }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
