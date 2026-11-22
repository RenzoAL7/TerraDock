# Imagen local del emulador oficial de AWS (https://github.com/aws/aws-emulator).
# AWS no publica imagen: se instala el paquete LTS para la arquitectura del host.
FROM public.ecr.aws/amazonlinux/amazonlinux:2023-minimal AS arch-amd64
ENV EMULATOR_RPM=x86_64
FROM public.ecr.aws/amazonlinux/amazonlinux:2023-minimal AS arch-arm64
ENV EMULATOR_RPM=aarch64
FROM arch-${TARGETARCH}
ADD https://downloads.aws.com/aws-emulator/packages/aws-emulator/LTS/latest/aws-emulator-${EMULATOR_RPM}.rpm /tmp/aws-emulator.rpm
RUN rpm -i /tmp/aws-emulator.rpm && rm /tmp/aws-emulator.rpm && mkdir -p /home/emulator && chown 1000 /home/emulator
ENV HOME=/home/emulator EMULATOR_TELEMETRY=off
USER 1000
EXPOSE 9297
ENTRYPOINT ["aws-emulator", "-b", "0.0.0.0"]
