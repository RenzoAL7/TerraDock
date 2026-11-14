import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { Project, Session } from "../src/lib/types";
import {
  buildResource,
  candidates,
  referenceExpression,
  suggestName,
  templates,
} from "../src/features/create/templates";

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
  baseURL,
}, testInfo) => {
  const remoteRequests: string[] = [];
  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (
      url.startsWith("http") &&
      new URL(url).origin !== new URL(baseURL!).origin
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
  // Three resources plus the ami_id variable they reference.
  const declared = (await project(request)).resources;
  expect(declared.filter((r) => r.block === "resource")).toHaveLength(3);
  expect(declared.map((r) => r.id)).toContain("var.ami_id");
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
  // The draft stays, now compared with the disk version.
  const diff = page.getByTestId("conflict-diff");
  await expect(diff.locator(".editor.modified .view-lines")).toContainText(
    "t3.medium",
  );
  await expect(diff.locator(".editor.original .view-lines")).toContainText(
    "t3.large",
  );
  await expect(
    page.getByRole("button", { name: "Descartar borrador", exact: true }),
  ).toBeEnabled();
});

test("un conflicto se compara y «Conservar el mío» guarda sobre la revisión nueva sin pisar el cambio externo", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const directory = await openLocalFolder(page);
  const file = join(directory, "main.tf");
  await openInstanceCode(page, "aws_instance.web");
  await replaceEditorContent(
    page,
    localSource.replace('"t3.micro"', '"t3.medium"'),
  );
  // Another program changes a different block of the same file.
  const external = localSource.replace("10.0.1.0/24", "10.0.9.0/24");
  await writeFile(file, external);
  const diff = page.getByTestId("conflict-diff");
  await expect(diff.getByRole("alert")).toContainText(
    "main.tf cambió fuera de TerraDock",
  );
  await expect(diff.locator(".editor.original .view-lines")).toContainText(
    "10.0.9.0/24",
  );
  await expect(diff.locator(".editor.modified .view-lines")).toContainText(
    "t3.medium",
  );
  const onDisk = (await project(request)).files[0];
  expect(onDisk.content).toBe(external);
  const saved = page.waitForRequest(
    (r) => r.url().endsWith("/api/files") && r.method() === "PUT",
  );
  await diff.getByRole("button", { name: "Conservar el mío" }).click();
  expect((await saved).postDataJSON()).toMatchObject({
    expectedRevision: onDisk.revision,
  });
  const merged = external.replace('"t3.micro"', '"t3.medium"');
  await expect.poll(() => readFile(file, "utf8")).toBe(merged);
  await expect(diff).toHaveCount(0);
  await expect(page.getByTestId("sync-status")).toContainText(
    "Sincronizado con el archivo",
  );
  await expect(page.locator(".view-lines")).toContainText("10.0.9.0/24");
});

test("si el borrador y el disco cambian la misma línea, se edita el resultado antes de guardarlo", async ({
  page,
}) => {
  await page.goto("/");
  const directory = await openLocalFolder(page);
  const file = join(directory, "main.tf");
  await openInstanceCode(page, "aws_instance.web");
  await replaceEditorContent(
    page,
    localSource.replace('"t3.micro"', '"t3.medium"'),
  );
  const external = localSource.replace('"t3.micro"', '"t3.large"');
  await writeFile(file, external);
  const diff = page.getByTestId("conflict-diff");
  await diff.getByRole("button", { name: "Conservar el mío" }).click();
  // Nothing is written while both versions touch the same line.
  await expect(diff.getByRole("alert")).toContainText("mismas líneas");
  await expect(diff.locator(".editor.modified .view-lines")).toContainText(
    "<<<<<<< tu borrador",
  );
  expect(await readFile(file, "utf8")).toBe(external);
  await diff.getByRole("button", { name: "Usar el del disco" }).click();
  await expect(diff).toHaveCount(0);
  await expect(page.locator(".view-lines")).toContainText("t3.large");
  expect(await readFile(file, "utf8")).toBe(external);
});

test("aplicar un resultado tras otro cambio en disco vuelve a comparar y no revierte ese cambio", async ({
  page,
}) => {
  await page.goto("/");
  const directory = await openLocalFolder(page);
  const file = join(directory, "main.tf");
  await openInstanceCode(page, "aws_instance.web");
  await replaceEditorContent(
    page,
    localSource.replace('"t3.micro"', '"t3.medium"'),
  );
  const v2 = localSource.replace('"t3.micro"', '"t3.large"');
  await writeFile(file, v2);
  const diff = page.getByTestId("conflict-diff");
  await diff.getByRole("button", { name: "Editar el resultado" }).click();
  // The file changes again while the result is being resolved by hand.
  const v3 = v2.replace("10.0.1.0/24", "10.0.9.0/24");
  await writeFile(file, v3);
  await expect(diff.getByRole("alert")).toContainText("volvió a cambiar");
  await diff.getByRole("button", { name: "Aplicar resultado" }).click();
  // The result was prepared against v2, so the comparison comes back with v3.
  await expect(diff.locator(".editor.original .view-lines")).toContainText(
    "10.0.9.0/24",
  );
  expect(await readFile(file, "utf8")).toBe(v3);
  await diff.getByRole("button", { name: "Conservar el mío" }).click();
  await expect
    .poll(() => readFile(file, "utf8"))
    .toBe(v3.replace('"t3.large"', '"t3.medium"'));
  await expect(diff).toHaveCount(0);
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
    // Our own save arrives over SSE first: it is not a conflict.
    await expect(page.getByTestId("conflict-diff")).toHaveCount(0);
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

test("Cmd+S durante un autoguardado del mismo archivo guarda después, sin conflicto falso", async ({
  page,
}) => {
  await setAutosave(page, true);
  await page.goto("/");
  const directory = await openLocalFolder(page);
  const file = join(directory, "main.tf");
  await openInstanceCode(page, "aws_instance.web");
  const first = localSource.replace('"t3.micro"', '"t3.small"');
  const second = localSource.replace('"t3.micro"', '"t3.large"');

  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let firstSaved!: (revision: string) => void;
  const savedRevision = new Promise<string>((resolve) => {
    firstSaved = resolve;
  });
  const puts: { expected: string; status: number; at: number }[] = [];
  await page.route("**/api/files", async (route) => {
    if (route.request().method() !== "PUT") return route.continue();
    const expected = route.request().postDataJSON().expectedRevision;
    const response = await route.fetch();
    const entry = { expected, status: response.status(), at: Date.now() };
    puts.push(entry);
    if (puts.length === 1) {
      const body = (await response.json()) as Project;
      firstSaved(body.files.find((f) => f.path === "main.tf")!.revision);
      // The server already wrote it; only the browser waits for the answer.
      await held;
    }
    await route.fulfill({ response });
  });
  try {
    await replaceEditorContent(page, first);
    const revision = await savedRevision;
    // Type more and save by hand while the autosave answer is pending.
    await replaceEditorContent(page, second);
    await page
      .getByRole("textbox", { name: /^Código Terraform (?:.*\/)?main\.tf$/ })
      .press("ControlOrMeta+S");
    await expect(page.getByText("Guardado pendiente")).toBeVisible();
    const releasedAt = Date.now();
    release();
    await expect.poll(() => readFile(file, "utf8")).toBe(second);
    expect(puts).toHaveLength(2);
    // The queued save uses the revision this tab just wrote: no 409, and it
    // runs at once instead of waiting for the next autosave.
    expect(puts[1]).toMatchObject({ expected: revision, status: 200 });
    expect(puts[1].at - releasedAt).toBeLessThan(450);
    await expect(page.getByTestId("conflict-diff")).toHaveCount(0);
    await expect(page.getByTestId("sync-status")).toContainText(
      "Sincronizado con el archivo",
    );
  } finally {
    release();
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

test("los valores sensibles no se muestran en la tarjeta ni en el inspector", async ({
  page,
}) => {
  await page.goto("/");
  await openLocalFolder(
    page,
    {
      "main.tf": `variable "db_password" {
  default   = "s3cr3t-pass"
  sensitive = true
}

variable "env" {
  default = "dev"
}

output "password" {
  value     = var.db_password
  sensitive = true
}
`,
    },
    "var.db_password",
  );
  const secret = page.getByTestId("node-var.db_password");
  await expect(secret).toContainText("(sensible)");
  await expect(secret).not.toContainText("s3cr3t");
  await expect(page.getByTestId("node-output.password")).toContainText(
    "(sensible)",
  );
  // Without sensitive = true the value is shown as before.
  await expect(page.getByTestId("node-var.env")).toContainText("dev");
  await page.getByTestId("resource-var.db_password").click();
  const inspector = page.getByRole("complementary", {
    name: "Inspector de propiedades",
  });
  await expect(inspector).toContainText("(sensible)");
  await expect(inspector).not.toContainText("s3cr3t");
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
  // The example has no .tf.json: nothing to warn about.
  await expect(page.getByTestId("floci-json")).toHaveCount(0);
});

test("la pestaña Floci avisa de que omite los .tf.json", async ({ page }) => {
  await page.goto("/");
  await openLocalFolder(page, {
    "main.tf": localSource,
    "extra.tf.json": '{"variable": {"region": {"default": "us-east-1"}}}',
  });
  await page.getByRole("button", { name: "Floci", exact: true }).click();
  await expect(page.getByTestId("floci-json")).toContainText(
    "Floci omite el archivo extra.tf.json",
  );
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

/** Every stored copy of one file (one per tab that left a draft), sorted. */
async function storedCopies(page: Page, file: string): Promise<string[]> {
  return page.evaluate(
    (path) =>
      new Promise<string[]>((resolve) => {
        const open = indexedDB.open("terradock", 1);
        open.onupgradeneeded = () =>
          open.result.createObjectStore("drafts", { keyPath: "key" });
        open.onerror = () => resolve([]);
        open.onsuccess = () => {
          const request = open.result
            .transaction("drafts", "readonly")
            .objectStore("drafts")
            .getAll();
          request.onsuccess = () => {
            open.result.close();
            resolve(
              (request.result as { file: string; content: string }[])
                .filter((entry) => entry.file === path)
                .map((entry) => entry.content)
                .sort(),
            );
          };
        };
      }),
    file,
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

test("escribir antes de decidir sobre un borrador recuperado no lo borra", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const original = (await project(request)).files.find(
    (file) => file.path === "main.tf",
  )!.content;
  const left = original.replace('"t3.small"', '"t3.anterior"');
  await openInstanceCode(page);
  await replaceEditorContent(page, left);
  await expect.poll(() => storedCopies(page, "main.tf")).toEqual([left]);
  await reloadKeepingDrafts(page);
  const offer = page.getByRole("status").filter({ hasText: "main.tf" });
  await expect(offer).toContainText("borrador sin guardar");
  // Typing in the same file before restoring keeps both copies.
  const typed = original.replace('"t3.small"', '"t3.nuevo"');
  await openInstanceCode(page);
  await replaceEditorContent(page, typed);
  await expect
    .poll(() => storedCopies(page, "main.tf"))
    .toEqual([left, typed].sort());
  await expect(offer).toContainText("Tu borrador actual no lo reemplaza");
  await expect(
    offer.getByRole("button", { name: "Restaurar borrador" }),
  ).toHaveCount(0);
  await expect(
    offer.getByRole("button", { name: "Descargar main.tf" }),
  ).toBeVisible();
  // Only an explicit decision removes the earlier one.
  await offer.getByRole("button", { name: "Descartar", exact: true }).click();
  await expect(offer).toHaveCount(0);
  await expect.poll(() => storedCopies(page, "main.tf")).toEqual([typed]);
  await expect(page.locator(".view-lines")).toContainText("t3.nuevo");
});

test("la ayuda borra los borradores guardados en este navegador", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const original = (await project(request)).files.find(
    (file) => file.path === "main.tf",
  )!.content;
  const left = original.replace('"t3.small"', '"t3.olvidado"');
  await openInstanceCode(page);
  await replaceEditorContent(page, left);
  await expect.poll(() => storedCopies(page, "main.tf")).toEqual([left]);
  await reloadKeepingDrafts(page);
  const offer = page.getByRole("status").filter({ hasText: "main.tf" });
  await expect(offer).toContainText("borrador sin guardar");
  await page.getByRole("button", { name: "Ayuda" }).click();
  const clear = page.getByRole("button", {
    name: "Borrar borradores guardados en este navegador",
  });
  await clear.click();
  await expect(page.getByText("Se borró 1 borrador guardado.")).toBeVisible();
  await expect.poll(() => storedCopies(page, "main.tf")).toEqual([]);
  await expect(offer).toHaveCount(0);
  // Nothing left: it says so instead of pretending to delete something.
  await clear.click();
  await expect(
    page.getByText("No había borradores guardados de pestañas cerradas."),
  ).toBeVisible();
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
  // The comparison is the first Monaco view after the reload: it must load
  // from the local bundle and show both versions.
  const diff = page.getByTestId("conflict-diff");
  await expect(diff.locator(".editor.original .view-lines")).toContainText(
    "10.0.9.0/24",
  );
  await expect(diff.locator(".editor.modified .view-lines")).toContainText(
    "t3.medium",
  );
  expect(await readFile(join(directory, "main.tf"), "utf8")).toBe(external);
});

/** 300 resource blocks over several files: VPCs, subnets, groups, instances. */
test("cada plantilla de la paleta produce un recurso válido en el servidor", async ({
  request,
}) => {
  // The demo project has a VPC, subnets and an AMI variable to point at.
  let current = await project(request);
  let content = current.files.find((f) => f.path === "main.tf")!.content;
  const revision = current.files.find((f) => f.path === "main.tf")!.revision;
  for (const template of templates) {
    const references: Record<string, string> = {};
    for (const attr of template.attributes)
      if ("reference" in attr) {
        const target = candidates(current.resources, attr.reference.type)[0];
        if (target)
          references[attr.name] = referenceExpression(
            target,
            attr.reference.attribute,
          );
      }
    const resource = buildResource(
      template,
      suggestName(template, current.resources),
      references,
    );
    const response = await request.post("/api/resource-draft", {
      headers: headers(),
      data: {
        projectId: current.id,
        path: "main.tf",
        content,
        expectedRevision: revision,
        resource,
      },
    });
    expect(response.ok(), template.type).toBeTruthy();
    content = ((await response.json()) as { content: string }).content;
    const preview = await request.post("/api/analyze", {
      headers: headers(),
      data: { projectId: current.id, files: { "main.tf": content } },
    });
    const analysis = (await preview.json()) as Project;
    expect(analysis.valid, template.type).toBe(true);
    expect(
      analysis.resources.some(
        (r) => r.id === `${resource.type}.${resource.name}`,
      ),
      template.type,
    ).toBe(true);
    current = { ...current, resources: analysis.resources };
  }
});

const createdSubnet = `
resource "aws_subnet" "db" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}
`;

test("crear un recurso desde el diagrama lo escribe en el archivo, lo selecciona y se puede deshacer y editar", async ({
  page,
}) => {
  await setAutosave(page, true);
  await page.goto("/");
  const directory = await openLocalFolder(page);
  const file = join(directory, "main.tf");
  await page
    .getByRole("button", { name: "Crear recurso", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Crear recurso" });
  await dialog.getByRole("button", { name: /^Subred/ }).click();
  // aws_subnet.app exists: the suggestion is numbered.
  await expect(dialog.getByLabel("Nombre", { exact: true })).toHaveValue(
    "app_2",
  );
  await dialog.getByLabel("Nombre", { exact: true }).fill("db");
  await expect(dialog.getByLabel("VPC (vpc_id)")).toHaveValue(
    "aws_vpc.main.id",
  );
  await expect(dialog.getByLabel("Archivo", { exact: true })).toHaveValue(
    "main.tf",
  );
  await dialog.getByRole("button", { name: "Crear recurso" }).click();
  await expect(dialog).not.toBeVisible();
  // Diagram → file: appended, the rest of the file byte for byte.
  await expect
    .poll(() => readFile(file, "utf8"))
    .toBe(localSource + createdSubnet);
  await expect(page.getByTestId("node-aws_subnet.db")).toBeVisible();
  await expect(page.getByTestId("resource-aws_subnet.db")).toHaveClass(
    /active/,
  );
  await expect(
    page.getByRole("complementary", { name: "Inspector de propiedades" }),
  ).toContainText("db");
  await expect(page.locator(".view-lines")).toContainText(
    'resource "aws_subnet" "db"',
  );
  // Undo removes exactly the block, through the same draft and autosave.
  await page
    .getByRole("status")
    .filter({ hasText: "Se añadió aws_subnet.db al final de main.tf." })
    .getByRole("button", { name: "Deshacer" })
    .click();
  await expect.poll(() => readFile(file, "utf8")).toBe(localSource);
  await expect(page.getByTestId("node-aws_subnet.db")).toHaveCount(0);

  // Right click on the canvas, into a new file; then edit it visually. The
  // event goes to the pane itself: after the undo the viewport may still be
  // centred on the removed node, with a group frame under any fixed point.
  await page
    .getByTestId("architecture-canvas")
    .locator(".react-flow__pane")
    .dispatchEvent("contextmenu", { button: 2 });
  await dialog.getByRole("button", { name: /^Subred/ }).click();
  await dialog.getByLabel("Nombre", { exact: true }).fill("db");
  await dialog.getByLabel("Archivo", { exact: true }).selectOption({
    label: "Archivo nuevo…",
  });
  await dialog.getByLabel("Nombre del archivo nuevo").fill("main.tf");
  await expect(dialog).toContainText("Ese archivo ya existe");
  await dialog.getByLabel("Nombre del archivo nuevo").fill("network.tf");
  await dialog.getByRole("button", { name: "Crear recurso" }).click();
  await expect(dialog).not.toBeVisible();
  const created = join(directory, "network.tf");
  await expect
    .poll(() => readFile(created, "utf8"))
    .toBe(createdSubnet.slice(1));
  await expect(page.getByTestId("node-aws_subnet.db")).toBeVisible();
  await page.getByLabel("cidr_block").fill("10.0.7.0/24");
  await expect
    .poll(() => readFile(created, "utf8"))
    .toBe(createdSubnet.slice(1).replace("10.0.1.0/24", "10.0.7.0/24"));
  expect(await readFile(file, "utf8")).toBe(localSource);
});

test("un fallo al crear el archivo se muestra en el diálogo y no en el aviso general", async ({
  page,
}) => {
  await page.goto("/");
  const directory = await openLocalFolder(page);
  // Another program creates the file between the check and the request.
  await page.route("**/api/resource-file", (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        code: "file_exists",
        error:
          "Ya existe un archivo con ese nombre en la carpeta. Elige otro nombre.",
      }),
    }),
  );
  await page
    .getByRole("button", { name: "Crear recurso", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Crear recurso" });
  await dialog.getByLabel("Archivo", { exact: true }).selectOption({
    label: "Archivo nuevo…",
  });
  await dialog.getByLabel("Nombre del archivo nuevo").fill("network.tf");
  await dialog.getByRole("button", { name: "Crear recurso" }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Ya existe un archivo con ese nombre en la carpeta. Elige otro nombre.",
  );
  await expect(page.locator(".global-message[role=alert]")).toHaveCount(0);
  // Closing the dialog drops its message; nothing is left behind.
  await dialog.getByRole("button", { name: "Cancelar" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".global-message[role=alert]")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Crear recurso", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(
    readFile(join(directory, "network.tf"), "utf8"),
  ).rejects.toThrow();
});

test("deshacer mientras el autoguardado del recurso está en curso no deja el bloque en el disco", async ({
  page,
}) => {
  await setAutosave(page, true);
  await page.goto("/");
  const directory = await openLocalFolder(page);
  const file = join(directory, "main.tf");
  // Hold the first save of the new block until undo has been pressed.
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  let saving = () => {};
  const started = new Promise<void>((resolve) => (saving = resolve));
  let first = true;
  let saves = 0;
  page.on("response", (response) => {
    if (response.url().endsWith("/api/files")) saves++;
  });
  await page.route("**/api/files", async (route) => {
    if (route.request().method() === "PUT" && first) {
      first = false;
      saving();
      await held;
    }
    await route.continue();
  });
  await page
    .getByRole("button", { name: "Crear recurso", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Crear recurso" });
  await dialog.getByRole("button", { name: /^Subred/ }).click();
  await dialog.getByLabel("Nombre", { exact: true }).fill("db");
  await dialog.getByRole("button", { name: "Crear recurso" }).click();
  await started;
  await page
    .getByRole("status")
    .filter({ hasText: "Se añadió aws_subnet.db al final de main.tf." })
    .getByRole("button", { name: "Deshacer" })
    .click();
  release();
  // The held save writes the block; the undo is saved right after it.
  await expect.poll(() => saves).toBeGreaterThanOrEqual(2);
  await expect.poll(() => readFile(file, "utf8")).toBe(localSource);
  await expect(page.getByTestId("node-aws_subnet.db")).toHaveCount(0);
  await expect(page.getByTestId("sync-status")).toHaveText(
    "Sincronizado con el archivo",
  );
});

test("crear un recurso mientras se autoguarda el archivo usa la revisión que dejó ese guardado", async ({
  page,
}) => {
  await setAutosave(page, true);
  await page.goto("/");
  const directory = await openLocalFolder(page);
  const file = join(directory, "main.tf");
  // Autosave waits for the live preview of the typed edit. Hold that preview
  // so the save starts only once the creation request is on its way.
  let holding = false;
  let releasePreview = () => {};
  const previewHeld = new Promise<void>(
    (resolve) => (releasePreview = resolve),
  );
  await page.route("**/api/analyze", async (route) => {
    if (holding) await previewHeld;
    await route.continue();
  });
  // The server answers the creation on the old revision; the answer reaches
  // the page only after the autosave has landed and cleared the draft.
  await page.route("**/api/resource-draft", async (route) => {
    const response = await route.fetch();
    const saved = page.waitForResponse(
      (r) => r.url().endsWith("/api/files") && r.request().method() === "PUT",
    );
    holding = false;
    releasePreview();
    await saved;
    await expect(page.getByTestId("sync-status")).toHaveText(
      "Sincronizado con el archivo",
    );
    await route.fulfill({ response });
  });
  await openInstanceCode(page, "aws_instance.web");
  await page
    .getByRole("button", { name: "Dividir vista", exact: true })
    .click();
  const edited = localSource.replace('"t3.micro"', '"t3.medium"');
  holding = true;
  await replaceEditorContent(page, edited);
  await page
    .getByRole("button", { name: "Crear recurso", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Crear recurso" });
  await dialog.getByRole("button", { name: /^Subred/ }).click();
  await dialog.getByLabel("Nombre", { exact: true }).fill("db");
  await dialog.getByRole("button", { name: "Crear recurso" }).click();
  await expect(dialog).not.toBeVisible();
  // The block is stored on top of the saved revision, not as a conflict.
  await expect
    .poll(() => readFile(file, "utf8"))
    .toContain('resource "aws_subnet" "db"');
  const saved = await readFile(file, "utf8");
  expect(saved.startsWith(edited)).toBe(true);
  await expect(page.getByTestId("sync-status")).toHaveText(
    "Sincronizado con el archivo",
  );
  await expect(page.getByText("en conflicto con el disco")).toHaveCount(0);
});

test("crear un recurso con un borrador abierto lo añade al borrador, no al disco", async ({
  page,
  request,
}) => {
  await page.goto("/");
  const directory = await openLocalFolder(page);
  const file = join(directory, "main.tf");
  await openInstanceCode(page, "aws_instance.web");
  const edited = localSource.replace('"t3.micro"', '"t3.medium"');
  await replaceEditorContent(page, edited);
  await page
    .getByRole("button", { name: "Dividir vista", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Crear recurso", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Crear recurso" });
  // VPC is the first template; its default name is taken.
  await dialog.getByLabel("Nombre", { exact: true }).fill("main");
  await expect(dialog).toContainText("Ya existe aws_vpc.main.");
  await expect(
    dialog.getByRole("button", { name: "Crear recurso" }),
  ).toBeDisabled();
  await dialog.getByLabel("Nombre", { exact: true }).fill("edge");
  await dialog.getByRole("button", { name: "Crear recurso" }).click();
  await expect(dialog).not.toBeVisible();
  const withVpc =
    edited + '\nresource "aws_vpc" "edge" {\n  cidr_block = "10.0.0.0/16"\n}\n';
  await expect(page.getByTestId("node-aws_vpc.edge")).toBeVisible();
  await expect(page.locator(".view-lines")).toContainText(
    'resource "aws_vpc" "edge"',
  );
  await expect(page.locator(".view-lines")).toContainText("t3.medium");
  // Autosave is off here: nothing reached the disk yet.
  expect(await readFile(file, "utf8")).toBe(localSource);
  await page
    .getByRole("button", { name: "Guardar archivo", exact: true })
    .click();
  await expect.poll(() => readFile(file, "utf8")).toBe(withVpc);
  expect(
    (await project(request)).resources.some((r) => r.id === "aws_vpc.edge"),
  ).toBe(true);
});

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

/** Records CSP violations reported by the page and by the console. */
async function watchCsp(page: Page): Promise<string[]> {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/Content Security Policy|Refused to/i.test(message.text()))
      violations.push(message.text());
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) =>
      console.error(
        `Refused by Content Security Policy: ${event.violatedDirective} ${event.blockedURI}`,
      ),
    );
  });
  return violations;
}

async function exportFile(page: Page, format: "SVG" | "PNG") {
  await page.getByRole("button", { name: "Exportar", exact: true }).click();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: new RegExp(`^${format}`) }).click();
  const file = await downloaded;
  return {
    name: file.suggestedFilename(),
    bytes: await readFile(await file.path()),
  };
}

/** Parses the SVG in the browser: XML errors and what it draws. */
async function parseSvg(page: Page, svg: string) {
  return page.evaluate((text) => {
    const doc = new DOMParser().parseFromString(text, "image/svg+xml");
    return {
      error: doc.querySelector("parsererror")?.textContent ?? "",
      root: doc.documentElement.nodeName,
      ids: [...doc.querySelectorAll("[data-id]")].map((n) =>
        n.getAttribute("data-id"),
      ),
      paths: doc.querySelectorAll("path[data-edge]").length,
      scripts: doc.querySelectorAll("script, foreignObject").length,
      band: doc.querySelector('[data-band="caption"]')?.textContent ?? "",
    };
  }, svg);
}

test("exporta el diagrama a SVG y PNG sin salir de la CSP local", async ({
  page,
  request,
}) => {
  const violations = await watchCsp(page);
  await page.goto("/");
  await expect(page.getByTestId("node-aws_instance.app_a")).toBeVisible();
  const expected = (await project(request)).resources.map((r) => r.id);

  const svg = await exportFile(page, "SVG");
  expect(svg.name).toMatch(/-arquitectura\.svg$/);
  const parsed = await parseSvg(page, svg.bytes.toString("utf8"));
  expect(parsed.error).toBe("");
  expect(parsed.root).toBe("svg");
  expect(parsed.scripts).toBe(0);
  expect(new Set(parsed.ids)).toEqual(new Set(expected));
  expect(parsed.ids).toHaveLength(expected.length);
  expect(parsed.paths).toBeGreaterThan(0);
  expect(parsed.band).toContain(`${expected.length} recursos`);
  // The fonts travel inside the file.
  expect(svg.bytes.toString("utf8")).toContain("data:font/woff2;base64,");

  const png = await exportFile(page, "PNG");
  expect(png.name).toMatch(/-arquitectura\.png$/);
  expect([...png.bytes.subarray(0, 8)]).toEqual([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  expect(png.bytes.subarray(12, 16).toString("ascii")).toBe("IHDR");
  expect(png.bytes.readUInt32BE(16)).toBeGreaterThan(600);
  expect(png.bytes.readUInt32BE(20)).toBeGreaterThan(200);
  expect(violations).toEqual([]);
});

test("con 300 recursos, el SVG incluye los nodos que no están en pantalla", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const violations = await watchCsp(page);
  await page.goto("/");
  await openLocalFolder(page, largeProject(300), "aws_vpc.v0");
  // Centered and zoomed on the first VPC, the last nodes are not rendered.
  await page.getByTestId("resource-aws_vpc.v0").click();
  await expect(page.getByTestId("node-aws_vpc.v0")).toBeVisible();
  await expect(page.getByTestId("node-aws_instance.i299")).toHaveCount(0);

  const svg = await exportFile(page, "SVG");
  const parsed = await parseSvg(page, svg.bytes.toString("utf8"));
  expect(parsed.error).toBe("");
  expect(parsed.ids).toHaveLength(300);
  expect(parsed.ids).toContain("aws_instance.i299");
  expect(parsed.band).toContain("300 recursos");

  const png = await exportFile(page, "PNG");
  expect(png.bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  expect(violations).toEqual([]);
});

/** Each rendered node's transform (its place in the diagram), by id. */
async function transforms(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() =>
    Object.fromEntries(
      [...document.querySelectorAll<HTMLElement>(".react-flow__node")].map(
        (node) => [node.dataset.id!, node.style.transform],
      ),
    ),
  );
}

/**
 * Pairs of rendered nodes that overlap on screen without one holding the
 * other (a VPC or subnet around its resources).
 */
async function overlaps(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const boxes = [
      ...document.querySelectorAll<HTMLElement>(".react-flow__node"),
    ].map((node) => ({
      id: node.dataset.id!,
      r: node.getBoundingClientRect(),
    }));
    const contains = (a: DOMRect, b: DOMRect) =>
      a.left <= b.left + 0.5 &&
      a.top <= b.top + 0.5 &&
      a.right >= b.right - 0.5 &&
      a.bottom >= b.bottom - 0.5;
    const found: string[] = [];
    for (let i = 0; i < boxes.length; i++)
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i].r,
          b = boxes[j].r;
        const meet =
          a.left < b.right - 0.5 &&
          b.left < a.right - 0.5 &&
          a.top < b.bottom - 0.5 &&
          b.top < a.bottom - 0.5;
        if (meet && !contains(a, b) && !contains(b, a))
          found.push(`${boxes[i].id} ↔ ${boxes[j].id}`);
      }
    return found;
  });
}

test("Ordenar coloca el diagrama sin solapes y en capas", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("node-aws_instance.app_a")).toBeVisible();
  await page.getByRole("button", { name: "Ordenar", exact: true }).click();
  await expect.poll(() => overlaps(page)).toEqual([]);
  // A project small enough to render every node: nothing overlaps either.
  await openLocalFolder(page, largeProject(60), "aws_vpc.v0");
  await page.getByRole("button", { name: "Ordenar", exact: true }).click();
  await expect.poll(() => overlaps(page)).toEqual([]);
  const placed = await transforms(page);
  expect(Object.keys(placed)).toHaveLength(60);
  // In layers: the group the instance references sits above it.
  const group = await page
    .getByTestId("node-aws_security_group.g2")
    .boundingBox();
  const instance = await page.getByTestId("node-aws_instance.i3").boundingBox();
  expect(instance!.y).toBeGreaterThan(group!.y + group!.height);
});

test("la ayuda enlaza los avisos de licencia que incluye el binario", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Ayuda", exact: true }).click();
  const layout = page.getByRole("link", { name: /dagre, graphlib/ });
  const fonts = page.getByRole("link", { name: "licencias de fuentes" });
  const layoutText = await (
    await request.get((await layout.getAttribute("href"))!)
  ).text();
  expect(layoutText).toContain("@dagrejs/dagre 3.1.3");
  expect(layoutText).toContain("Permission is hereby granted");
  expect(
    await (await request.get((await fonts.getAttribute("href"))!)).text(),
  ).toContain("SIL OPEN FONT LICENSE");
});

test("escribir un recurso nuevo o cambiar de vista no mueve los nodos existentes", async ({
  page,
}) => {
  await page.goto("/");
  await openLocalFolder(page);
  await expect(page.getByTestId("node-aws_instance.web")).toBeVisible();
  const before = await transforms(page);
  expect(Object.keys(before).sort()).toEqual([
    "aws_instance.web",
    "aws_subnet.app",
    "aws_vpc.main",
  ]);

  // Switching views (the code view unmounts the diagram) moves nothing.
  await page.getByRole("button", { name: "Código", exact: true }).click();
  await page
    .getByRole("button", { name: "Dividir vista", exact: true })
    .click();
  await expect(page.getByTestId("node-aws_instance.web")).toBeVisible();
  expect(await transforms(page)).toEqual(before);

  // A bucket typed in the middle of the file, and one inside the subnet.
  await page.getByTestId("resource-aws_instance.web").click();
  await replaceEditorContent(
    page,
    localSource.replace(
      'resource "aws_subnet" "app"',
      'resource "aws_s3_bucket" "typed" {\n  bucket_prefix = "typed-"\n}\n\nresource "aws_subnet" "app"',
    ) +
      '\nresource "aws_instance" "worker" {\n  ami           = var.ami_id\n  instance_type = "t3.micro"\n  subnet_id     = aws_subnet.app.id\n}\n',
  );
  await expect(page.getByTestId("node-aws_s3_bucket.typed")).toBeVisible();
  await expect(page.getByTestId("node-aws_instance.worker")).toBeVisible();
  const after = await transforms(page);
  for (const id of Object.keys(before))
    expect(after[id], `${id} no se movió`).toBe(before[id]);
  await expect.poll(() => overlaps(page)).toEqual([]);
});
