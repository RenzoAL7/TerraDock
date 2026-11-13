import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { Project, Session } from "../src/lib/types";

const localSource = `# This comment must survive a visual edit.
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "app" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}

resource "aws_instance" "web" {
  ami           = var.ami_id
  instance_type = "t3.micro"
  subnet_id     = aws_subnet.app.id
}
`;

let session: Session;
let createdDirectories: string[];
let browserErrors: string[];

const headers = () => ({ "X-TerraDock-Session": session.token });

async function project(request: APIRequestContext): Promise<Project> {
  const response = await request.get("/api/project");
  expect(response.ok()).toBeTruthy();
  return response.json() as Promise<Project>;
}

async function resetDemo(request: APIRequestContext) {
  const response = await request.post("/api/demo", {
    headers: headers(),
    data: { template: "web-app" },
  });
  expect(response.ok()).toBeTruthy();
}

async function openLocalFolder(
  page: Page,
  files: Record<string, string> = { "main.tf": localSource },
  firstResource = "aws_instance.web",
): Promise<string> {
  // Never write fixtures into a developer's project or a reused application.
  expect(basename(session.root)).toBe("projects");
  expect(basename(dirname(session.root))).toMatch(/^terradock-e2e-/);
  const directory = await mkdtemp(join(session.root, "workspace-"));
  createdDirectories.push(directory);
  for (const [name, content] of Object.entries(files))
    await writeFile(join(directory, name), content);

  await page
    .getByRole("button", { name: "Abrir carpeta", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Abrir carpeta local" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Abrir esta carpeta" }),
  ).toBeEnabled();
  await dialog
    .getByRole("textbox", { name: "Ruta de carpeta" })
    .fill(directory);
  const navigated = page.waitForResponse(
    (response) =>
      response.url().includes("/api/directories?") &&
      response.url().includes(encodeURIComponent(directory)),
  );
  await dialog.getByRole("button", { name: "Ir a la ruta" }).click();
  expect((await navigated).ok()).toBeTruthy();
  await dialog.getByRole("button", { name: "Abrir esta carpeta" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByTestId(`resource-${firstResource}`)).toBeVisible();
  return directory;
}

async function openInstanceCode(page: Page, id = "aws_instance.app_a") {
  await page.getByTestId(`resource-${id}`).click();
  await page.getByRole("button", { name: /^main\.tf:\d+$/ }).click();
  await expect(
    page.getByRole("textbox", {
      name: /^Código Terraform (?:.*\/)?main\.tf$/,
    }),
  ).toBeVisible();
}

async function replaceEditorContent(
  page: Page,
  content: string,
  file = "main.tf",
) {
  const editor = page.getByRole("textbox", {
    name: new RegExp(`^Código Terraform (?:.*/)?${file.replace(".", "\\.")}$`),
  });
  // Monaco paints code above its accessible EditContext input. Focus that
  // keyboard target instead of clicking the covered input's coordinates.
  await editor.focus();
  await expect(editor).toBeFocused();
  await editor.press("ControlOrMeta+A");
  // Pasting is the user operation for a complete HCL document. insertText
  // emits typing events and Monaco applies indentation after each newline.
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.evaluate((text) => navigator.clipboard.writeText(text), content);
  await editor.press("ControlOrMeta+V");
}

async function setAutosave(page: Page, enabled: boolean) {
  await page.addInitScript(
    (value) => {
      localStorage.setItem("terradock.autosave", value);
    },
    enabled ? "on" : "off",
  );
}

test.beforeEach(async ({ request, page }) => {
  createdDirectories = [];
  browserErrors = [];
  // Manual-save scenarios below; live autosave has its own tests.
  await setAutosave(page, false);
  page.on("pageerror", (error) => browserErrors.push(error.message));
  const response = await request.get("/api/session");
  expect(response.ok()).toBeTruthy();
  session = (await response.json()) as Session;
  await resetDemo(request);
});

test.afterEach(async ({ request }) => {
  await resetDemo(request);
  await Promise.all(
    createdDirectories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
  expect(browserErrors).toEqual([]);
});

test("sirve arquitectura y Monaco desde los assets locales de producción", async ({
  page,
}, testInfo) => {
  const remoteRequests: string[] = [];
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (
      url.startsWith("http") &&
      new URL(url).origin !== "http://127.0.0.1:7332"
    ) {
      remoteRequests.push(url);
      await route.abort();
      return;
    }
    await route.continue();
  });
  await page.goto("/");
  await expect(page.getByTestId("architecture-canvas")).toBeVisible();
  await expect(page.getByTestId("node-aws_instance.app_a")).toContainText(
    "t3.small",
  );
  await page.screenshot({
    path: testInfo.outputPath("workspace.png"),
    animations: "disabled",
  });
  await openInstanceCode(page);
  await expect(page.locator(".view-lines")).toContainText("instance_type");
  await page.screenshot({
    path: testInfo.outputPath("editor.png"),
    animations: "disabled",
  });
  expect(remoteRequests).toEqual([]);
});

test("permite explorar la arquitectura y abrir ayuda en una pantalla estrecha", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByTestId("architecture-canvas")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Mostrar explorador", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Ayuda", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Tu workspace de Terraform",
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cerrar diálogo" }).click();
  await expect(dialog).not.toBeVisible();
});

test("una propiedad se refleja al instante en el diagrama y el código, y se guarda en el archivo", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const before = await project(request);
  const original = before.files.find(
    (file) => file.path === "main.tf",
  )!.content;
  await page.getByTestId("resource-aws_instance.app_a").click();
  await page.getByLabel("instance_type").fill("t3.medium");
  // Graph → code, live: no save needed to see it everywhere.
  await expect(page.getByTestId("node-aws_instance.app_a")).toContainText(
    "t3.medium",
  );
  await expect(page.getByTestId("sync-status")).toContainText("en vivo");
  expect(
    (await project(request)).files.find((file) => file.path === "main.tf")!
      .content,
  ).toBe(original);
  await openInstanceCode(page);
  await expect(page.locator(".view-lines")).toContainText("t3.medium");
  await page
    .getByRole("button", { name: "Guardar archivo", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await project(request)).files.find((file) => file.path === "main.tf")!
          .content,
    )
    .toBe(original.replace('"t3.small"', '"t3.medium"'));
});

test("escribir en el código actualiza el diagrama en vivo sin guardar", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const before = await project(request);
  const original = before.files.find(
    (file) => file.path === "main.tf",
  )!.content;
  await openInstanceCode(page);
  await page
    .getByRole("button", { name: "Dividir vista", exact: true })
    .click();
  await replaceEditorContent(
    page,
    original.replace('"t3.small"', '"t3.xlarge"'),
  );
  await expect(page.getByTestId("node-aws_instance.app_a")).toContainText(
    "t3.xlarge",
  );
  await expect(page.getByLabel("instance_type")).toHaveValue("t3.xlarge");
  expect(
    (await project(request)).files.find((file) => file.path === "main.tf")!
      .content,
  ).toBe(original);
});

test("guardar código actualiza las propiedades y la arquitectura", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const before = await project(request);
  const updated = before.files
    .find((file) => file.path === "main.tf")!
    .content.replace('"t3.small"', '"t3.large"');
  await openInstanceCode(page);
  await replaceEditorContent(page, updated);
  await page
    .getByRole("button", { name: "Guardar archivo", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await project(request)).files.find((file) => file.path === "main.tf")!
          .content,
    )
    .toBe(updated);
  await page.getByRole("button", { name: "Arquitectura", exact: true }).click();
  await expect(page.getByTestId("node-aws_instance.app_a")).toContainText(
    "t3.large",
  );
  await expect(page.getByLabel("instance_type")).toHaveValue("t3.large");
});

test("cambia entre los ejemplos y muestra su propio conjunto de recursos", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Ejemplos", exact: true }).click();
  await page.getByRole("button", { name: /Red mínima AWS/ }).click();
  await expect(page.getByTestId("resource-aws_instance.web")).toBeVisible();
  expect((await project(request)).resources).toHaveLength(3);
  await expect(page.getByTestId("resource-aws_instance.app_a")).toHaveCount(0);
  await page.getByRole("button", { name: "Ejemplos", exact: true }).click();
  await page.getByRole("button", { name: /Aplicación web AWS/ }).click();
  await expect(page.getByTestId("resource-aws_instance.app_a")).toBeVisible();
  await expect(page.getByTestId("resource-aws_instance.web")).toHaveCount(0);
});

test("un error de sintaxis conserva el gráfico anterior y muestra los diagnósticos", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const before = await project(request);
  await openInstanceCode(page);
  await replaceEditorContent(page, 'resource "aws_instance" "incomplete" {\n');
  await page
    .getByRole("button", { name: "Guardar archivo", exact: true })
    .click();
  await expect.poll(async () => (await project(request)).valid).toBe(false);
  const after = await project(request);
  expect(after.resources.map((resource) => resource.id)).toEqual(
    before.resources.map((resource) => resource.id),
  );
  expect(
    after.diagnostics.some((diagnostic) => diagnostic.severity === "error"),
  ).toBe(true);
  await page.getByRole("button", { name: "Arquitectura", exact: true }).click();
  await expect(page.getByTestId("node-aws_instance.app_a")).toBeVisible();
  await page
    .getByRole("button", {
      name: /El gráfico conserva la última configuración válida/,
    })
    .click();
  await expect(
    page.getByText("ERROR DE HCL", { exact: true }).first(),
  ).toBeVisible();
});

test("con autoguardado, una propiedad llega al archivo real y los cambios externos al diagrama", async ({
  page,
}) => {
  await setAutosave(page, true);
  await page.goto("/");
  const directory = await openLocalFolder(page);
  const file = join(directory, "main.tf");
  await page.getByTestId("resource-aws_instance.web").click();
  await page.getByLabel("instance_type").fill("t3.small");
  await expect
    .poll(() => readFile(file, "utf8"))
    .toBe(localSource.replace('"t3.micro"', '"t3.small"'));
  const external = localSource.replace('"t3.micro"', '"t3.large"');
  await writeFile(file, external);
  await expect(page.getByTestId("node-aws_instance.web")).toContainText(
    "t3.large",
  );
  await expect(page.getByLabel("instance_type")).toHaveValue("t3.large");
});

test("bloquea un guardado obsoleto y conserva el borrador y el archivo externo", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const directory = await openLocalFolder(page);
  const file = join(directory, "main.tf");
  const original = await project(request);
  await openInstanceCode(page, "aws_instance.web");
  await replaceEditorContent(
    page,
    localSource.replace('"t3.micro"', '"t3.medium"'),
  );
  const external = localSource.replace('"t3.micro"', '"t3.large"');
  await writeFile(file, external);
  await expect
    .poll(async () => (await project(request)).files[0].content)
    .toBe(external);
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /cambió|conflicto/i })
      .first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Guardar archivo", exact: true }),
  ).toBeDisabled();
  const rejected = await request.put("/api/files", {
    headers: headers(),
    data: {
      projectId: original.id,
      path: "main.tf",
      expectedRevision: original.files[0].revision,
      content: localSource.replace('"t3.micro"', '"t3.medium"'),
    },
  });
  expect(rejected.status()).toBe(409);
  expect(await rejected.json()).toMatchObject({ code: "revision_conflict" });
  expect(await readFile(file, "utf8")).toBe(external);
  await expect(page.locator(".view-lines")).toContainText("t3.medium");
  await expect(
    page.getByRole("button", { name: "Descartar borrador", exact: true }),
  ).toBeEnabled();
});

test("conserva lo escrito mientras llega la respuesta de un guardado anterior", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const original = (await project(request)).files.find(
    (file) => file.path === "main.tf",
  )!.content;
  const firstContent = original.replace('"t3.small"', '"t3.medium"');
  const secondContent = original.replace('"t3.small"', '"t3.large"');
  await openInstanceCode(page);

  let releaseResponse!: () => void;
  let notifySaved!: () => void;
  let finishRoute!: () => void;
  let intercepted = false;
  const heldResponse = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  const serverSaved = new Promise<void>((resolve) => {
    notifySaved = resolve;
  });
  const routeFinished = new Promise<void>((resolve) => {
    finishRoute = resolve;
  });
  await page.route("**/api/files", async (route) => {
    if (route.request().method() !== "PUT" || intercepted) {
      await route.continue();
      return;
    }
    intercepted = true;
    // The server already saved the first revision. Only its browser response
    // is delayed, so SSE and more typing can arrive before the save resolves.
    try {
      const response = await route.fetch();
      notifySaved();
      await heldResponse;
      await route.fulfill({ response });
    } finally {
      finishRoute();
    }
  });

  try {
    await replaceEditorContent(page, firstContent);
    const save = page.getByRole("button", {
      name: "Guardar archivo",
      exact: true,
    });
    await save.click();
    await serverSaved;
    expect(
      (await project(request)).files.find((file) => file.path === "main.tf")!
        .content,
    ).toBe(firstContent);
    await replaceEditorContent(page, secondContent);
    const delivered = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/files") &&
        response.request().method() === "PUT",
    );
    releaseResponse();
    expect((await delivered).ok()).toBeTruthy();

    await expect(save).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Descartar borrador", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".view-lines")).toContainText("t3.large");
    await save.click();
    await expect
      .poll(
        async () =>
          (await project(request)).files.find(
            (file) => file.path === "main.tf",
          )!.content,
      )
      .toBe(secondContent);
    await expect(save).toBeDisabled();
  } finally {
    releaseResponse();
    if (intercepted) await routeFinished;
    await page.unroute("**/api/files");
  }
});

test("el autoguardado espera a que el HCL sea válido", async ({
  page,
  request,
}) => {
  await setAutosave(page, true);
  await page.goto("/");
  const directory = await openLocalFolder(page);
  const file = join(directory, "main.tf");
  await openInstanceCode(page, "aws_instance.web");
  await replaceEditorContent(
    page,
    localSource + 'resource "aws_s3_bucket" {\n',
  );
  await expect(page.getByText(/autoguardado en pausa/)).toBeVisible();
  await page.waitForTimeout(1200);
  expect(await readFile(file, "utf8")).toBe(localSource);
  const fixed = localSource.replace('"t3.micro"', '"t3.nano"');
  await replaceEditorContent(page, fixed);
  await expect.poll(() => readFile(file, "utf8")).toBe(fixed);
  expect((await project(request)).valid).toBe(true);
});

test("la pestaña Floci muestra el estado del emulador y de Terraform", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Floci", exact: true }).click();
  await expect(page.getByText("Estado en Floci")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Generar plan", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Aplicar plan", exact: true }),
  ).toBeDisabled();
});

test("solo la pestaña Floci consulta /api/floci", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (entry) => {
    if (new URL(entry.url()).pathname.startsWith("/api/floci"))
      requests.push(entry.url());
  });
  await page.clock.install();
  await page.goto("/");
  await expect(page.getByTestId("resource-aws_instance.app_a")).toBeVisible();
  // Opening the project and viewing the diagram never asks for Floci status,
  // so the server never runs Terraform for it.
  await page.clock.runFor(30_000);
  expect(requests).toEqual([]);

  await page.getByRole("button", { name: "Floci", exact: true }).click();
  await expect.poll(() => requests.length).toBeGreaterThan(0);

  await page.getByRole("button", { name: "Arquitectura", exact: true }).click();
  await expect(page.getByTestId("resource-aws_instance.app_a")).toBeVisible();
  const seen = requests.length;
  await page.clock.runFor(30_000);
  expect(requests.length).toBe(seen);
});

test("descartar el borrador también descarta lo escrito en el inspector", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("resource-aws_instance.app_a").click();
  await page.getByLabel("instance_type").fill("t3.medium");
  await expect(page.getByTestId("node-aws_instance.app_a")).toContainText(
    "t3.medium",
  );
  await page
    .getByRole("button", { name: "Dividir vista", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Descartar borrador", exact: true })
    .click();
  await expect(page.getByLabel("instance_type")).toHaveValue("t3.small");
  await expect(page.getByTestId("node-aws_instance.app_a")).toContainText(
    "t3.small",
  );
});

/** Drafts this browser profile keeps in IndexedDB, by file. */
async function storedDrafts(page: Page): Promise<Record<string, string>> {
  return page.evaluate(
    () =>
      new Promise<Record<string, string>>((resolve) => {
        const open = indexedDB.open("terradock", 1);
        open.onupgradeneeded = () =>
          open.result.createObjectStore("drafts", { keyPath: "key" });
        open.onerror = () => resolve({});
        open.onsuccess = () => {
          const request = open.result
            .transaction("drafts", "readonly")
            .objectStore("drafts")
            .getAll();
          request.onsuccess = () => {
            open.result.close();
            resolve(
              Object.fromEntries(
                (request.result as { file: string; content: string }[]).map(
                  (entry) => [entry.file, entry.content],
                ),
              ),
            );
          };
        };
      }),
  );
}

async function reloadKeepingDrafts(page: Page) {
  // Unsaved drafts still ask before leaving; accept like a user who reloads.
  page.once("dialog", (dialog) => void dialog.accept());
  await page.reload();
}

test("un borrador sobrevive a recargar la pestaña y se puede restaurar", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const original = (await project(request)).files.find(
    (file) => file.path === "main.tf",
  )!.content;
  const typed = original.replace('"t3.small"', '"t3.recuperado"');
  await openInstanceCode(page);
  await replaceEditorContent(page, typed);
  await expect
    .poll(async () => (await storedDrafts(page))["main.tf"])
    .toBe(typed);
  await reloadKeepingDrafts(page);
  const offer = page.getByRole("status").filter({ hasText: "main.tf" });
  await expect(offer).toContainText("borrador sin guardar");
  await offer.getByRole("button", { name: "Restaurar borrador" }).click();
  await expect(offer).toHaveCount(0);
  await expect(page.locator(".view-lines")).toContainText("t3.recuperado");
  await page.getByRole("button", { name: "Arquitectura", exact: true }).click();
  await expect(page.getByTestId("node-aws_instance.app_a")).toContainText(
    "t3.recuperado",
  );
  expect(
    (await project(request)).files.find((file) => file.path === "main.tf")!
      .content,
  ).toBe(original);
  // Discarding the restored draft also forgets it in the browser profile.
  await page.getByRole("button", { name: "Código", exact: true }).click();
  await page
    .getByRole("button", { name: "Descartar borrador", exact: true })
    .click();
  await expect.poll(async () => await storedDrafts(page)).toEqual({});
});

test("al recargar con el archivo cambiado por fuera se ofrece comparar", async ({
  page,
}) => {
  await page.goto("/");
  const directory = await openLocalFolder(page);
  const typed = localSource.replace('"t3.micro"', '"t3.medium"');
  await openInstanceCode(page, "aws_instance.web");
  await replaceEditorContent(page, typed);
  await expect
    .poll(async () => (await storedDrafts(page))["main.tf"])
    .toBe(typed);
  const external = localSource.replace("10.0.1.0/24", "10.0.9.0/24");
  await writeFile(join(directory, "main.tf"), external);
  await reloadKeepingDrafts(page);
  const offer = page.getByRole("status").filter({ hasText: "main.tf" });
  await expect(offer).toContainText("cambió fuera de TerraDock");
  await expect(
    offer.getByRole("button", { name: "Restaurar borrador" }),
  ).toHaveCount(0);
  await offer.getByRole("button", { name: "Comparar con el disco" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: /cambió|conflicto/i })
      .first(),
  ).toBeVisible();
  expect(await readFile(join(directory, "main.tf"), "utf8")).toBe(external);
});

/** 300 resource blocks over several files: VPCs, subnets, groups, instances. */
function largeProject(count: number): Record<string, string> {
  const files: Record<string, string> = {};
  let body = "";
  for (let i = 0; i < count; i++) {
    const vpc = Math.floor(i / 4) * 4;
    body +=
      i % 4 === 0
        ? `resource "aws_vpc" "v${i}" {\n  cidr_block = "10.${i % 250}.0.0/16"\n}\n\n`
        : i % 4 === 1
          ? `resource "aws_subnet" "s${i}" {\n  vpc_id = aws_vpc.v${vpc}.id\n  cidr_block = "10.${vpc % 250}.1.0/24"\n}\n\n`
          : i % 4 === 2
            ? `resource "aws_security_group" "g${i}" {\n  vpc_id = aws_vpc.v${vpc}.id\n  description = "group ${i}"\n}\n\n`
            : `resource "aws_instance" "i${i}" {\n  ami = "ami-123"\n  instance_type = "t3.micro"\n  subnet_id = aws_subnet.s${i - 2}.id\n  vpc_security_group_ids = [aws_security_group.g${i - 1}.id]\n}\n\n`;
    if (i % 40 === 39 || i === count - 1) {
      files[`part${String(Object.keys(files).length).padStart(2, "0")}.tf`] =
        body;
      body = "";
    }
  }
  return files;
}

test("con 300 recursos, archivo, código e inspector llegan al diagrama en menos de 1 s", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await page.goto("/");
  const files = largeProject(300);
  const directory = await openLocalFolder(page, files, "aws_vpc.v0");
  const id = "aws_instance.i3";
  const node = `[data-testid="node-${id}"]`;
  const reached = async (text: string, started = Date.now()) => {
    await page.waitForFunction(
      ([selector, value]) =>
        document.querySelector(selector)?.textContent?.includes(value),
      [node, text] as const,
      { polling: "raf", timeout: 5_000 },
    );
    return Date.now() - started;
  };
  // Selecting from the explorer must bring the node on screen and, in split
  // view, its block into the editor.
  await page
    .getByRole("button", { name: "Dividir vista", exact: true })
    .click();
  await page.getByTestId(`resource-${id}`).click();
  await expect(page.locator(node)).toBeVisible();
  const timings: Record<string, number> = {};
  const external = files["part00.tf"].replace(
    /("i3" \{\n {2}ami = "ami-123"\n {2}instance_type = )"t3\.micro"/,
    '$1"t3.ext"',
  );
  let started = Date.now();
  await writeFile(join(directory, "part00.tf"), external);
  timings.archivo = await reached("t3.ext", started);
  started = Date.now();
  await page.getByLabel("instance_type").fill("t3.inspector");
  timings.inspector = await reached("t3.inspector", started);
  await expect(page.locator(".view-lines")).toContainText("t3.inspector");
  started = Date.now();
  await replaceEditorContent(
    page,
    external.replace('"t3.ext"', '"t3.codigo"'),
    "part00.tf",
  );
  timings.codigo = await reached("t3.codigo", started);
  test.info().annotations.push({
    type: "latencia (ms)",
    description: JSON.stringify(timings),
  });
  for (const [path, ms] of Object.entries(timings))
    expect(ms, `${path} → diagrama`).toBeLessThan(1_000);
});
