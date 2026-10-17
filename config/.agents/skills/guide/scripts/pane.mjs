// Orca のペインを分割する向き（`orca terminal split --direction`）。desk.mjs と takt アダプタはここだけを見る。
// vertical で左右に分かれて右に新しいペインが、horizontal で上下に分かれて下に新しいペインができる、として書く。
// 実機で並びが逆になっていたら、ここの値だけを入れ替える。
export const SPLIT_RIGHT = "vertical";
export const SPLIT_DOWN = "horizontal";
