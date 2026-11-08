// Conexão com o Supabase (servidor do jogo)
import { SUPABASE_URL, SUPABASE_KEY } from './config.js';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'dvt-auth' },
});
let uid = null;
const err = (e) => { throw new Error(e.message || String(e)); };

export default {
  async init() {
    let { data: { session } } = await sb.auth.getSession();
    if (!session) {
      const { data, error } = await sb.auth.signInAnonymously();
      if (error) err(error);
      session = data.session;
    }
    uid = session.user.id;
    return uid;
  },
  async listCases() {
    const { data, error } = await sb.from('cases').select('*').order('id');
    if (error) err(error); return data;
  },
  async createRoom(name, color, caseId) {
    const { data, error } = await sb.rpc('create_room', { p_name: name, p_color: color, p_case: caseId });
    if (error) err(error); return data;
  },
  async findRoom(code) {
    const { data, error } = await sb.from('rooms').select('*').eq('code', code.toUpperCase().trim()).maybeSingle();
    if (error) err(error); return data;
  },
  async joinRoom(code, name, color) {
    const { data, error } = await sb.rpc('join_room', { p_code: code, p_name: name, p_color: color });
    if (error) err(error); return data;
  },
  async getRoom(id) {
    const { data, error } = await sb.from('rooms').select('*').eq('id', id).maybeSingle();
    if (error) err(error); return data;
  },
  subscribe(id, cb) {
    const ch = sb.channel('room-' + id)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rooms', filter: `id=eq.${id}` }, (p) => cb(p.new))
      .subscribe();
    return () => sb.removeChannel(ch);
  },
  // grava o novo estado; devolve null se outra pessoa gravou antes (conflito)
  async update(room, patch) {
    const { data, error } = await sb.from('rooms').update({ ...patch, version: room.version + 1 })
      .eq('id', room.id).eq('version', room.version).select().maybeSingle();
    if (error) err(error); return data;
  },
  async readClue(roomId, loc) {
    const { data, error } = await sb.rpc('read_clue', { p_room: roomId, p_loc: loc });
    if (error) err(error); return data;
  },
  async getNotebook(roomId) {
    const { data, error } = await sb.from('notebooks').select('*').eq('room_id', roomId).eq('user_id', uid).maybeSingle();
    if (error) err(error); return data || { clues: {}, answers: {}, notes: '' };
  },
  async saveNotebook(roomId, answers, notes) {
    const { error } = await sb.from('notebooks').upsert({ room_id: roomId, user_id: uid, answers, notes }, { onConflict: 'room_id,user_id' });
    if (error) err(error);
  },
  async revealSolution(roomId) {
    const { data, error } = await sb.rpc('reveal_solution', { p_room: roomId });
    if (error) err(error); return data;
  },
};
