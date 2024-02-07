#Download base image ubuntu 18.04
FROM ubuntu:22.04

# Set root user
USER root

# Update Ubuntu Software repository and install python, jupyter and git
RUN apt-get update && apt-get install -y nano && apt-get install -y curl && \
    apt-get install -y sshpass && apt-get install -y python3 && apt-get install -y python3-pip && \
    python3 -m pip install --upgrade pip && python3 -m pip install jupyter && python3 -m pip install notebook==6.4.12 && \
    python3 -m pip install traitlets==5.9.0 && python3 -m pip install jupyter_contrib_nbextensions jupyter_nbextensions_configurator && \
    jupyter contrib nbextension install --user && jupyter nbextensions_configurator enable --user && \
    python3 -m pip install IM-client && apt-get install -y git && \
    python3 -m pip install numpy scipy matplotlib

# Create the script to init jupyter server
RUN echo "#!/bin/bash" > /bin/jupyter-apricot && \
    echo "jupyter notebook --ip 0.0.0.0 --no-browser" >> /bin/jupyter-apricot && \
    chmod +x /bin/jupyter-apricot

# Create a user for jupyter server
RUN useradd -ms /bin/bash jupyserver

# Change to jupyter server user
USER jupyserver
WORKDIR /home/jupyserver

# Clone git, install, get the examples and clear files
RUN git clone https://github.com/AntonioSanch3z/apricot.git && cd /home/jupyserver/apricot \
    && sh install.sh && cd /home/jupyserver && cp -r apricot/examples . && mv apricot .apricot_git

# Set entry point
ENTRYPOINT ["/bin/jupyter-apricot"]
