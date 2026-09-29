# A stock Armagetron dedicated server built from this very source tree, so the
# browser client is tested against the same codebase it was compiled from.
# Build from the REPO ROOT:  docker build -f bridge/test-server/Dockerfile -t aa-dedicated .
#
# python3 IS A BUILD DEPENDENCY, not an oversight in the brief's package list.
# The `resource` subdirectory's `included` target runs batch/make/sortresources,
# which at line 30 does
#     PYTHON=`which python3 python python2 2>/dev/null | head -n 1`
# and then invokes `${PYTHON} sortresources.py`. With no python on PATH that
# expands to the empty string, so the shell tries to exec the .py file itself,
# it is not executable, and the build dies with
#     python is
#     ../batch/make/sortresources: 32: ../batch/make/sortresources.py: Permission denied
#     make[2]: *** [Makefile:514: included] Error 1
# -- AFTER src/ has compiled and linked cleanly, which is why it reads like a
# packaging error rather than a missing tool. configure never probes for python,
# so ./configure succeeds and says nothing about it.
FROM debian:bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential automake autoconf libtool pkg-config \
        libxml2-dev zlib1g-dev ca-certificates python3 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
COPY . /src

RUN ./bootstrap.sh
RUN ./configure --enable-dedicated --disable-glout --disable-sysinstall --prefix=/opt/aa
RUN make -j"$(nproc)" && make install

RUN mkdir -p /data
EXPOSE 4534/udp
CMD ["/opt/aa/bin/armagetronad-dedicated", "--userdatadir", "/data"]
