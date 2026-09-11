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

async function openLocalFolder(page: Page): Promise<string> {
  // Never write fixtures into a developer's project or a reused application.
  expect(basename(session.root)).toBe("projects");
  expect(basename(dirname(session.root))).toMatch(/^terradock-e2e-/);
  const directory = await mkdtemp(join(session.root, "workspace-"));
  createdDirectories.push(directory);
  await writeFile(join(directory, "main.tf"), localSource);

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
  await expect(page.getByTestId("resource-aws_instance.web")).toBeVisible();
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

async function replaceEditorContent(page: Page, content: string) {
  const editor = page.getByRole("textbox", {
    name: /^Código Terraform (?:.*\/)?main\.tf$/,
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

test.beforeEach(async ({ request, page }) => {
  createdDirectories = [];
  browserErrors = [];
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

test("guardar una propiedad actualiza el modelo, el diagrama y el código original", async ({
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
  await page
    .getByRole("button", { name: "Guardar propiedad", exact: true })
    .click();
  await expect(page.getByTestId("node-aws_instance.app_a")).toContainText(
    "t3.medium",
  );
  const after = await project(request);
  expect(after.files.find((file) => file.path === "main.tf")!.content).toBe(
    original.replace('"t3.small"', '"t3.medium"'),
  );
  await openInstanceCode(page);
  await expect(page.locator(".view-lines")).toContainText("t3.medium");
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

test("abre una carpeta real, escribe una propiedad y observa cambios externos", async ({
  page,
}) => {
  await page.goto("/");
  const directory = await openLocalFolder(page);
  const file = join(directory, "main.tf");
  await page.getByTestId("resource-aws_instance.web").click();
  await page.getByLabel("instance_type").fill("t3.small");
  await page
    .getByRole("button", { name: "Guardar propiedad", exact: true })
    .click();
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
