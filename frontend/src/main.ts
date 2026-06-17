import "./style.css";
import { Network } from "./net/Network";
import { MenuChoice, Menu } from "./ui/Menu";
import { Game } from "./game/Game";
import { ServerMessage } from "./protocol";

type Welcome = Extract<ServerMessage, { type: "welcome" }>;

const canvas = document.getElementById("scene") as HTMLCanvasElement;
const menu = new Menu();

menu.onPlay(async (choice) => {
  menu.setBusy(true);
  menu.setStatus("Connecting…");
  try {
    const net = new Network();
    await net.connect();
    const welcome = await join(net, choice);
    menu.hide();
    new Game(net, canvas, welcome).start();
  } catch {
    menu.setStatus(
      "Couldn't reach the server — make sure the backend is running on :8080.",
      true,
    );
    menu.setBusy(false);
  }
});

/** Send the join request and resolve once the server welcomes us. */
function join(net: Network, choice: MenuChoice): Promise<Welcome> {
  return new Promise<Welcome>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("join timed out")), 8000);
    net.onMessage((msg) => {
      if (msg.type === "welcome") {
        clearTimeout(timer);
        resolve(msg);
      }
    });
    net.send({ type: "join", name: choice.name, mode: choice.mode });
  });
}
