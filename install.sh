
#!/bin/bash

#Create ec3 RADL template file (just in case)
mkdir -p $HOME/.ec3/templates

#Install and enable plugin content
if jupyter nbextension install apricot_plugin; then
    echo -e "Plugin installed."
    
else

    echo -e "Plugin installation failed!"
    exit 2
fi

if jupyter nbextension enable apricot_plugin/main; then
    echo -e "Plugin enabled."
    
else

    echo -e "Fail enabling plugin!"
fi


#Install apricot magics (default python)
if python3 -m pip install --find-links=file:apricot_magic/ apricot_magic/; then

    echo -e "magics succesfuly installed"
    
else
    echo -e "Unable to install apricop magics"
    exit 3
fi

#Install apricot magics (python3)
if python3 -m pip install --find-links=file:apricot_magic/ apricot_magic/; then

    echo -e "magics succesfuly installed"
    
else
    echo -e "Unable to install apricop magics with python3"
fi