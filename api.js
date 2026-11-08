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
  async listFinished() {
    const { data, error } = await sb.from('rooms').select('id,case_id,state,created_at').eq('status', 'finished').order('created_at', { ascending: false }).limit(1000);
    if (error) err(error); return data;
  },
  async rpc(fn, args = {}) {
    const { data, error } = await sb.rpc(fn, args);
    if (error) err(error); return data;
  },
  myAccess() { return this.rpc('my_access'); },
  claimAdmin(secret) { return this.rpc('claim_admin', { p_secret: secret }); },
  createInvite() { return this.rpc('create_invite'); },
  redeemCode(token, name) { return this.rpc('redeem_code', { p_token: token, p_name: name }); },
  createRelease(games) { return this.rpc('create_release', { p_games: games }); },
  setAdminPhone(phone) { return this.rpc('set_admin_phone', { p_phone: phone }); },
  adminPlayers() { return this.rpc('admin_players'); },
  async adminPhone() {
    const { data, error } = await sb.from('app_config').select('value').eq('key', 'admin_phone').maybeSingle();
    if (error) err(error); return data?.value || '';
  },
  async importCases(secret, cases) {
    const { data, error } = await sb.rpc('import_cases', { p_secret: secret, p_cases: cases });
    if (error) err(error); return data;
  },
  async revealSolution(roomId) {
    const { data, error } = await sb.rpc('reveal_solution', { p_room: roomId });
    if (error) err(error); return data;
  },
};
